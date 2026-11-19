package com.openplane.studio.usb

/**
 * Прямые вызовы в Rust (src-tauri/src/usb_android.rs, функции
 * `Java_com_openplane_studio_usb_UsbNative_*`): байты порта идут из потока
 * чтения сразу в Rust, без JSON и без главного потока.
 */
object UsbNative {
    @JvmStatic external fun data(id: Int, bytes: ByteArray)
    @JvmStatic external fun closed(id: Int, reason: String)
}
