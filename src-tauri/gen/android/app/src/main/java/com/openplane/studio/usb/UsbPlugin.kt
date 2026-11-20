package com.openplane.studio.usb

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiNetworkSpecifier
import android.os.Build
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.hoho.android.usbserial.driver.CdcAcmSerialDriver
import com.hoho.android.usbserial.driver.UsbSerialPort
import com.hoho.android.usbserial.driver.UsbSerialProber
import com.hoho.android.usbserial.util.SerialInputOutputManager
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * USB-OTG для OpenPlane Studio: только «сырой» доступ к USB.
 * Протокол прошивки (DfuSe) и консоль платы — в Rust (src-tauri/src/usb_android.rs,
 * dfuse.rs); входящие байты порта уходят в Rust прямым JNI-вызовом [UsbNative.data].
 *
 * Команды зовутся из Rust (`run_mobile_plugin`) на главном потоке Android, поэтому
 * всё, что ждёт USB, выполняется на своих потоках: [io] — открытие и DFU (порядок
 * передач важен), [writer] — запись в порт.
 */
@TauriPlugin
class UsbPlugin(private val activity: Activity) : Plugin(activity) {
    private val usb = activity.getSystemService(Context.USB_SERVICE) as UsbManager
    private val io = Executors.newSingleThreadExecutor()
    private val writer = Executors.newSingleThreadExecutor()
    private val net = Executors.newSingleThreadExecutor()
    private val serials = ConcurrentHashMap<Int, Serial>()
    private val dfus = ConcurrentHashMap<Int, Dfu>()

    private class Serial(val port: UsbSerialPort, val reader: SerialInputOutputManager)
    private class Dfu(val device: UsbDevice, val conn: UsbDeviceConnection, var intf: UsbInterface? = null)

    private fun guarded(invoke: Invoke, body: () -> Unit) {
        try {
            body()
        } catch (e: Exception) {
            invoke.reject(e.message ?: e.toString())
        }
    }

    private fun device(invoke: Invoke): UsbDevice? {
        val name = invoke.getArgs().getString("name", "") ?: ""
        val d = usb.deviceList[name]
        if (d == null) invoke.reject("NOT_FOUND: устройство отключено ($name)")
        return d
    }

    /** Разрешение Android на устройство; есть — сразу [then] на потоке [io]. */
    private fun withPermission(device: UsbDevice, invoke: Invoke, then: () -> Unit) {
        if (usb.hasPermission(device)) {
            io.execute { guarded(invoke, then) }
            return
        }
        val action = activity.packageName + ".USB_PERMISSION"
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context, i: Intent) {
                if (i.action != action) return
                try {
                    activity.unregisterReceiver(this)
                } catch (_: Exception) {
                }
                if (usb.hasPermission(device)) io.execute { guarded(invoke, then) }
                else invoke.reject("NO_PERMISSION: нет доступа к USB — разрешите устройство в окне Android")
            }
        }
        val filter = IntentFilter(action)
        if (Build.VERSION.SDK_INT >= 33) activity.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        else activity.registerReceiver(receiver, filter)
        // явный пакет: Android 14 не даёт изменяемый PendingIntent с неявным Intent
        val intent = Intent(action).setPackage(activity.packageName)
        val flags = if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0
        usb.requestPermission(device, PendingIntent.getBroadcast(activity, device.deviceId, intent, flags))
    }

    private fun bytes(args: JSObject, key: String): ByteArray {
        val arr = args.getJSONArray(key)
        return ByteArray(arr.length()) { arr.getInt(it).toByte() }
    }

    private fun json(b: ByteArray, n: Int = b.size): JSArray {
        val arr = JSArray()
        for (i in 0 until n) arr.put(b[i].toInt() and 0xFF)
        return arr
    }

    // ---------- список ----------

    @Command
    fun listDevices(invoke: Invoke) {
        val arr = JSArray()
        for (d in usb.deviceList.values) {
            val o = JSObject()
            o.put("name", d.deviceName)
            o.put("vid", d.vendorId)
            o.put("pid", d.productId)
            o.put("product", d.productName)
            o.put("manufacturer", d.manufacturerName)
            // серийник без разрешения бросает SecurityException (Android 10+)
            try {
                if (usb.hasPermission(d)) o.put("serial", d.serialNumber)
            } catch (_: SecurityException) {
            }
            arr.put(o)
        }
        val res = JSObject()
        res.put("devices", arr)
        invoke.resolve(res)
    }

    // ---------- порт (CDC и мосты) ----------

    @Command
    fun serialOpen(invoke: Invoke) {
        val args = invoke.getArgs()
        val id = args.getInteger("id") ?: return invoke.reject("serialOpen: нет id")
        val baud = args.getInteger("baud", 115200)
        val dtr = args.getBoolean("dtr", false) ?: false
        val dev = device(invoke) ?: return
        withPermission(dev, invoke) {
            // наш STM32 (0483:5740) и родной USB ESP32 — CDC ACM; мосты CH34x/CP210x/FTDI — свои драйверы
            val driver = UsbSerialProber.getDefaultProber().probeDevice(dev) ?: CdcAcmSerialDriver(dev)
            val port = driver.ports[0]
            val conn = usb.openDevice(dev) ?: throw IOException("Android не открыл устройство")
            port.open(conn)
            try {
                port.setParameters(baud, 8, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE)
            } catch (_: UnsupportedOperationException) {
            }
            // без DTR наша прошивка на STM32 молчит; у ESP32 DTR/RTS — сброс, не трогаем
            if (dtr) port.dtr = true
            val reader = SerialInputOutputManager(port, object : SerialInputOutputManager.Listener {
                override fun onNewData(data: ByteArray) = UsbNative.data(id, data)
                override fun onRunError(e: Exception) {
                    closeSerial(id)
                    UsbNative.closed(id, e.message ?: "USB")
                }
            })
            serials[id] = Serial(port, reader)
            reader.start()
            val res = JSObject()
            res.put("id", id)
            invoke.resolve(res)
        }
    }

    @Command
    fun serialWrite(invoke: Invoke) {
        val args = invoke.getArgs()
        val s = serials[args.getInteger("id") ?: -1] ?: return invoke.reject("PORT_CLOSED: порт закрыт")
        val data = bytes(args, "data")
        writer.execute {
            guarded(invoke) {
                s.port.write(data, 1000)
                invoke.resolve()
            }
        }
    }

    private fun closeSerial(id: Int) {
        val s = serials.remove(id) ?: return
        try {
            s.reader.stop()
        } catch (_: Exception) {
        }
        try {
            s.port.close()
        } catch (_: Exception) {
        }
    }

    @Command
    fun serialClose(invoke: Invoke) {
        val id = invoke.getArgs().getInteger("id") ?: -1
        io.execute {
            closeSerial(id)
            invoke.resolve()
        }
    }

    // ---------- загрузчик DFU (0483:DF11) ----------

    /** Имя интерфейса по сырым дескрипторам, если Android его не прочитал. */
    private fun interfaceName(conn: UsbDeviceConnection, raw: ByteArray, number: Int, alt: Int): String {
        var o = 0
        while (o + 8 < raw.size) {
            val len = raw[o].toInt() and 0xFF
            if (len == 0) break
            if (raw[o + 1].toInt() == 4 && raw[o + 2].toInt() == number && raw[o + 3].toInt() == alt) {
                val index = raw[o + 8].toInt() and 0xFF
                if (index == 0) return ""
                val buf = ByteArray(255)
                val n = conn.controlTransfer(0x80, 6, (3 shl 8) or index, 0x0409, buf, buf.size, 1000)
                if (n < 2) return ""
                return String(buf, 2, minOf(n, buf[0].toInt() and 0xFF) - 2, Charsets.UTF_16LE)
            }
            o += len
        }
        return ""
    }

    @Command
    fun dfuOpen(invoke: Invoke) {
        val id = invoke.getArgs().getInteger("id") ?: return invoke.reject("dfuOpen: нет id")
        val dev = device(invoke) ?: return
        withPermission(dev, invoke) {
            val conn = usb.openDevice(dev) ?: throw IOException("Android не открыл загрузчик")
            val raw = conn.rawDescriptors ?: ByteArray(0)
            val alts = JSArray()
            for (i in 0 until dev.interfaceCount) {
                val itf = dev.getInterface(i)
                if (itf.interfaceClass != UsbConstants.USB_CLASS_APP_SPEC || itf.interfaceSubclass != 1) continue
                val o = JSObject()
                o.put("interface", itf.id)
                o.put("alt", itf.alternateSetting)
                o.put("name", itf.name?.takeIf { it.isNotEmpty() } ?: interfaceName(conn, raw, itf.id, itf.alternateSetting))
                alts.put(o)
            }
            dfus[id] = Dfu(dev, conn)
            val res = JSObject()
            res.put("id", id)
            res.put("raw", json(raw))
            res.put("alts", alts)
            invoke.resolve(res)
        }
    }

    private fun dfu(invoke: Invoke): Dfu? {
        val d = dfus[invoke.getArgs().getInteger("id") ?: -1]
        if (d == null) invoke.reject("DFU_CLOSED: загрузчик не открыт")
        return d
    }

    @Command
    fun dfuClaim(invoke: Invoke) {
        val args = invoke.getArgs()
        val d = dfu(invoke) ?: return
        val number = args.getInteger("interface", 0)
        val alt = args.getInteger("alt", 0)
        io.execute {
            guarded(invoke) {
                val itf = (0 until d.device.interfaceCount).map { d.device.getInterface(it) }
                    .firstOrNull { it.id == number && it.alternateSetting == alt }
                    ?: throw IOException("DFU: нет интерфейса $number/$alt")
                if (!d.conn.claimInterface(itf, true)) throw IOException("DFU: интерфейс занят")
                d.conn.setInterface(itf)
                d.intf = itf
                invoke.resolve()
            }
        }
    }

    @Command
    fun dfuOut(invoke: Invoke) {
        val args = invoke.getArgs()
        val d = dfu(invoke) ?: return
        val request = args.getInteger("request", 0)
        val value = args.getInteger("value", 0)
        val data = bytes(args, "data")
        io.execute {
            guarded(invoke) {
                val itf = d.intf?.id ?: 0
                // класс, интерфейс, к устройству; стирание сектора H743 — до ~4 с
                val n = d.conn.controlTransfer(0x21, request, value, itf, if (data.isEmpty()) null else data, data.size, 10000)
                if (n < 0) throw IOException("USB: передача $request не прошла")
                invoke.resolve()
            }
        }
    }

    @Command
    fun dfuIn(invoke: Invoke) {
        val args = invoke.getArgs()
        val d = dfu(invoke) ?: return
        val request = args.getInteger("request", 0)
        val value = args.getInteger("value", 0)
        val length = args.getInteger("length", 0)
        io.execute {
            guarded(invoke) {
                val itf = d.intf?.id ?: 0
                val buf = ByteArray(length)
                val n = d.conn.controlTransfer(0xA1, request, value, itf, buf, length, 10000)
                if (n < 0) throw IOException("USB: чтение $request не прошло")
                val res = JSObject()
                res.put("data", json(buf, n))
                invoke.resolve(res)
            }
        }
    }

    @Command
    fun dfuClose(invoke: Invoke) {
        val id = invoke.getArgs().getInteger("id") ?: -1
        io.execute {
            dfus.remove(id)?.let { d ->
                try {
                    d.intf?.let { d.conn.releaseInterface(it) }
                } catch (_: Exception) {
                }
                d.conn.close()
            }
            invoke.resolve()
        }
    }

    // ---------- сеть: готовый .bin из релиза (P49) ----------

    /**
     * Скачать файл в кэш приложения и вернуть путь (Rust читает и удаляет).
     * Окно само не может: github.com отвечает на releases/latest/download без CORS.
     * Только https://github.com/…; редиректы на release-assets идут сами (https → https).
     */
    @Command
    fun download(invoke: Invoke) {
        val args = invoke.getArgs()
        val url = args.getString("url", "") ?: ""
        val max = args.getInteger("max", 4 * 1024 * 1024)
        if (!url.startsWith("https://github.com/")) {
            invoke.reject("BAD_URL: только github.com")
            return
        }
        net.execute {
            guarded(invoke) {
                val conn = URL(url).openConnection() as HttpURLConnection
                try {
                    conn.connectTimeout = 20000
                    conn.readTimeout = 30000
                    conn.instanceFollowRedirects = true
                    conn.setRequestProperty("User-Agent", "OpenPlane-Studio")
                    val code = conn.responseCode
                    if (code == 404) throw IOException("NOT_FOUND: в релизе нет файла")
                    if (code !in 200..299) throw IOException("HTTP $code")
                    val out = File.createTempFile("release-", ".bin", activity.cacheDir)
                    var total = 0
                    conn.inputStream.use { input ->
                        out.outputStream().use { o ->
                            val buf = ByteArray(64 * 1024)
                            while (true) {
                                val n = input.read(buf)
                                if (n < 0) break
                                total += n
                                if (total > max) {
                                    out.delete()
                                    throw IOException("TOO_BIG: больше $max байт")
                                }
                                o.write(buf, 0, n)
                            }
                        }
                    }
                    val res = JSObject()
                    res.put("path", out.absolutePath)
                    res.put("size", total)
                    invoke.resolve(res)
                } finally {
                    conn.disconnect()
                }
            }
        }
    }
    // ---------- WiFi платы (P50): прошивка самолёта на ESP32 ----------

    private val connectivity by lazy { activity.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager }
    @Volatile private var wifiCallback: ConnectivityManager.NetworkCallback? = null

    private fun releaseWifi() {
        connectivity.bindProcessToNetwork(null)
        wifiCallback?.let { cb -> runCatching { connectivity.unregisterNetworkCallback(cb) } }
        wifiCallback = null
    }

    /**
     * Подключиться к точке доступа платы (`WIFI_AP_SSID` из конфига самолёта) и привязать
     * к ней процесс — сокеты Rust (`wifi_ota.rs`) пойдут на 192.168.4.1 этой сети, а не в
     * мобильный интернет. Android 10+ сам показывает окно «Подключиться к …?»; сеть без
     * интернета, общий WiFi телефона не меняется. Ответ — когда сеть поднялась или отказ.
     */
    @Command
    fun wifiJoin(invoke: Invoke) {
        val args = invoke.getArgs()
        val ssid = args.getString("ssid", "") ?: ""
        val password = args.getString("password", "") ?: ""
        if (ssid.isEmpty()) {
            invoke.reject("BAD_SSID: нет имени сети")
            return
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            invoke.reject("OLD_ANDROID: нужен Android 10 — подключитесь к сети «$ssid» вручную")
            return
        }
        guarded(invoke) {
            releaseWifi()
            val spec = WifiNetworkSpecifier.Builder().setSsid(ssid).apply {
                if (password.isNotEmpty()) setWpa2Passphrase(password)
            }.build()
            val request = NetworkRequest.Builder()
                .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .setNetworkSpecifier(spec)
                .build()
            val answered = AtomicBoolean(false)
            val cb = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    connectivity.bindProcessToNetwork(network)
                    if (answered.compareAndSet(false, true)) {
                        val res = JSObject()
                        res.put("ssid", ssid)
                        invoke.resolve(res)
                    }
                }

                override fun onUnavailable() {
                    wifiCallback = null
                    if (answered.compareAndSet(false, true)) {
                        invoke.reject("NO_NETWORK: сеть «$ssid» не найдена или подключение отменено")
                    }
                }

                override fun onLost(network: Network) {
                    // плата перезагружается в новую прошивку — запрос живой, Android подключится снова
                    connectivity.bindProcessToNetwork(null)
                }
            }
            wifiCallback = cb
            connectivity.requestNetwork(request, cb, 60000)
        }
    }

    /** Отвязать процесс от сети платы и снять запрос (телефон вернётся в свой WiFi). */
    @Command
    fun wifiRelease(invoke: Invoke) {
        guarded(invoke) {
            releaseWifi()
            invoke.resolve()
        }
    }
}
