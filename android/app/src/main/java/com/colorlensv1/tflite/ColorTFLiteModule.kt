package com.colorlensv1.tflite

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Callback
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.ReadableArray

class ColorTFLiteModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private val helper = ColorTFLiteHelper(reactContext.applicationContext)
    private var labelCount: Int = 0

    override fun getName(): String {
        return "ColorTFLite"
    }

    @ReactMethod
    fun loadModel(callback: Callback) {
        try {
        println("ColorTFLite: Starting to load color_model.tflite...")
        helper.loadModel()
        labelCount = helper.getLabelCount()
        println("ColorTFLite: Model loaded successfully! Label count: $labelCount")
        callback.invoke(null, true)
    } catch (e: Exception) {
        println("ColorTFLite: Failed to load model - ${e.message}")
        callback.invoke(e.message, null)
    }
}

    @ReactMethod
    fun predict(features: ReadableArray, callback: Callback) {
        try {
            val interp = helper.interpreter ?: run {
                println("ColorTFLite: Model not loaded, falling back to fallback method")
                callback.invoke("model_not_loaded", null)
                return
            }

            val featureCount = features.size()
            if (featureCount <= 0) {
                println("ColorTFLite: Empty feature array passed to predict")
                callback.invoke("empty_features", null)
                return
            }

            println("ColorTFLite: Prediction called with ${'$'}featureCount features")

            val input = Array(1) { FloatArray(featureCount) }
            for (i in 0 until featureCount) {
                input[0][i] = features.getDouble(i).toFloat()
            }

            val outSize = if (labelCount > 0) labelCount else 12
            val output = Array(1) { FloatArray(outSize) }

            println("ColorTFLite: Running TFLite interpreter with input[1][${'$'}featureCount] -> output[1][${'$'}outSize]")
            interp.run(input, output)

            val probs = output[0]
            var maxIdx = 0
            var maxVal = probs[0]
            for (i in probs.indices) {
                if (probs[i] > maxVal) {
                    maxVal = probs[i]
                    maxIdx = i
                }
            }

            println("ColorTFLite: Prediction result - Index: ${'$'}maxIdx, Score: ${'$'}maxVal")
            val result: WritableMap = Arguments.createMap()
            result.putInt("index", maxIdx)
            result.putDouble("score", maxVal.toDouble())
            callback.invoke(null, result)
        } catch (e: Exception) {
            println("ColorTFLite: Error during prediction - ${'$'}{e.message}")
            callback.invoke(e.message, null)
        }
    }

    @ReactMethod
    fun close(callback: Callback) {
        helper.close()
        callback.invoke(null, true)
    }
}
