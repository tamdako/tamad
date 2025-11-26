package com.colorlensv1

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import com.facebook.react.bridge.*
import java.io.FileInputStream
import java.io.InputStream
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

class ImageDecoderModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    companion object {
        private const val SAMPLE_RADIUS_RATIO = 0.08
        private const val MIN_SAMPLE_RADIUS = 4
    }
    override fun getName(): String {
        return "ImageDecoderModule"
    }

    @ReactMethod
    fun decodeScaledRegion(uriStr: String?, relX: Double, relY: Double, previewW: Double, previewH: Double, promise: Promise) {
        if (uriStr == null) {
            promise.resolve(null)
            return
        }
        val ctx = reactApplicationContext
        var input: InputStream? = null
        try {
            val uri = Uri.parse(uriStr)
            input = if (uri.scheme == "file") {
                FileInputStream(uri.path)
            } else {
                ctx.contentResolver.openInputStream(uri)
            }
            if (input == null) {
                promise.resolve(null)
                return
            }

            // First pass: just bounds
            val optsBounds = BitmapFactory.Options()
            optsBounds.inJustDecodeBounds = true
            BitmapFactory.decodeStream(input, null, optsBounds)
            try { input.close() } catch (_: Exception) {}

            val imgW = optsBounds.outWidth
            val imgH = optsBounds.outHeight
            if (imgW <= 0 || imgH <= 0) {
                promise.resolve(null)
                return
            }

            // choose a conservative target max dimension to limit memory (256px)
            val targetMax = 256
            var inSampleSize = 1
            while (imgW / inSampleSize > targetMax || imgH / inSampleSize > targetMax) {
                inSampleSize *= 2
            }

            // reopen stream
            val input2 = if (uri.scheme == "file") FileInputStream(uri.path) else ctx.contentResolver.openInputStream(uri)
            if (input2 == null) {
                promise.resolve(null)
                return
            }

            val opts = BitmapFactory.Options()
            opts.inSampleSize = inSampleSize
            opts.inPreferredConfig = Bitmap.Config.ARGB_8888
            val bmp: Bitmap? = BitmapFactory.decodeStream(input2, null, opts)
            try { input2.close() } catch (_: Exception) {}
            if (bmp == null) {
                promise.resolve(null)
                return
            }

            val bmpW = bmp.width
            val bmpH = bmp.height

            val ix = if (previewW > 0 && previewH > 0) {
                ((relX / previewW) * bmpW).roundToInt()
            } else {
                bmpW / 2
            }
            val iy = if (previewW > 0 && previewH > 0) {
                ((relY / previewH) * bmpH).roundToInt()
            } else {
                bmpH / 2
            }

            val clampX = max(0, min(bmpW - 1, ix))
            val clampY = max(0, min(bmpH - 1, iy))

            val minDim = min(bmpW, bmpH)
            val computedRadius = (minDim * SAMPLE_RADIUS_RATIO).roundToInt()
            val half = max(MIN_SAMPLE_RADIUS, computedRadius)
            var rSum = 0
            var gSum = 0
            var bSum = 0
            var count = 0
            for (yy in max(0, clampY - half)..min(bmpH - 1, clampY + half)) {
                for (xx in max(0, clampX - half)..min(bmpW - 1, clampX + half)) {
                    val pixel = bmp.getPixel(xx, yy)
                    rSum += (pixel shr 16) and 0xff
                    gSum += (pixel shr 8) and 0xff
                    bSum += pixel and 0xff
                    count += 1
                }
            }

            bmp.recycle()

            if (count == 0) {
                promise.resolve(null)
                return
            }

            val r = (rSum / count)
            val g = (gSum / count)
            val b = (bSum / count)

            val map = Arguments.createMap()
            map.putInt("r", r)
            map.putInt("g", g)
            map.putInt("b", b)
            promise.resolve(map)
        } catch (ex: Exception) {
            try { input?.close() } catch (_: Exception) {}
            promise.reject("ERR_DECODE", ex.message)
        }
    }
}
