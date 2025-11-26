"""
Train model directly from colormodel.json using precomputed color spaces.
This is better than CSV since all features are already in the JSON file.
"""
from pathlib import Path
import json
import numpy as np
import tensorflow as tf
from sklearn.preprocessing import LabelEncoder
from sklearn.utils.class_weight import compute_class_weight
from tensorflow.keras.utils import to_categorical
from collections import Counter
import argparse
import pickle

BASE = Path(__file__).resolve().parent
COLORMODEL = BASE.parent.joinpath('colormodel.json')
out_dir = BASE.joinpath('output')

parser = argparse.ArgumentParser()
parser.add_argument('--label_field', choices=['family','name'], default='family')
parser.add_argument('--samples_per_class', type=int, default=3000)
parser.add_argument('--epochs', type=int, default=150)
parser.add_argument('--batch_size', type=int, default=32)
parser.add_argument('--quantize', action='store_true')
parser.add_argument('--output_dir', default=str(out_dir))
args = parser.parse_args()

out_dir = Path(args.output_dir)
out_dir.mkdir(parents=True, exist_ok=True)

print("[INFO] Loading colormodel.json (using precomputed color spaces)...")
with open(COLORMODEL, 'r', encoding='utf-8-sig') as f:
    data = json.load(f)

print(f"   Found {len(data)} colors in colormodel.json")

# Extract all 21 features directly from precomputed JSON values
X_rows = []
y_rows = []

for item in data:
    label = item.get(args.label_field) or item.get('name', '')
    if not label:
        continue
    
    features = []
    
    # CAM16-UCS (3)
    if item.get('cam16ucs') and len(item['cam16ucs']) >= 3:
        features.extend([float(item['cam16ucs'][i]) for i in range(3)])
    else:
        features.extend([0.0, 0.0, 0.0])
    
    # JzAzBz (3)
    if item.get('jzazbz') and len(item['jzazbz']) >= 3:
        features.extend([float(item['jzazbz'][i]) for i in range(3)])
    else:
        features.extend([0.0, 0.0, 0.0])
    
    # OKLab (3) - convert from OKLCH if needed
    if item.get('oklab') and len(item['oklab']) >= 3:
        features.extend([float(item['oklab'][i]) for i in range(3)])
    elif item.get('oklch') and len(item['oklch']) >= 3:
        L = float(item['oklch'][0])
        C = float(item['oklch'][1]) if len(item['oklch']) > 1 else 0
        h = float(item['oklch'][2]) if len(item['oklch']) > 2 else 0
        features.extend([L, C * np.cos(np.radians(h)), C * np.sin(np.radians(h))])
    else:
        features.extend([0.0, 0.0, 0.0])
    
    # RGB linear (3)
    if item.get('rgb_linear') and len(item['rgb_linear']) >= 3:
        features.extend([float(item['rgb_linear'][i]) for i in range(3)])
    else:
        features.extend([0.0, 0.0, 0.0])
    
    # XYZ (3)
    if item.get('xyz') and len(item['xyz']) >= 3:
        features.extend([float(item['xyz'][i]) for i in range(3)])
    else:
        features.extend([0.0, 0.0, 0.0])
    
    # ICtCp (3)
    if item.get('ictcp') and len(item['ictcp']) >= 3:
        features.extend([float(item['ictcp'][i]) for i in range(3)])
    else:
        features.extend([0.0, 0.0, 0.0])
    
    # IPT (3)
    if item.get('ipt') and len(item['ipt']) >= 3:
        features.extend([float(item['ipt'][i]) for i in range(3)])
    else:
        features.extend([0.0, 0.0, 0.0])
    
    # Only add if at least some features are non-zero
    if any(abs(f) > 1e-6 for f in features):
        X_rows.append(features)
        y_rows.append(label)

if len(X_rows) == 0:
    raise SystemExit('[ERROR] no valid features found in colormodel.json')

print(f"   Extracted {len(X_rows)} colors with 21 features each")

# Augment: generate multiple samples per color
print(f"   Generating {args.samples_per_class} augmented samples per class...")
np.random.seed(42)

label_to_indices = {}
for i, label in enumerate(y_rows):
    if label not in label_to_indices:
        label_to_indices[label] = []
    label_to_indices[label].append(i)

X_base = np.array(X_rows, dtype=np.float32)
y_base = np.array(y_rows, dtype=object)

X_augmented = []
y_augmented = []

for label, indices in label_to_indices.items():
    base_samples = X_base[indices]
    per_color = max(1, args.samples_per_class // len(indices))
    
    # Original
    X_augmented.append(base_samples)
    y_augmented.extend([label] * len(indices))
    
    # Augmented with noise
    for _ in range(per_color):
        noise = np.random.normal(0, 0.02, size=base_samples.shape).astype(np.float32)
        X_augmented.append(base_samples + noise)
        y_augmented.extend([label] * len(indices))

X = np.vstack(X_augmented).astype(np.float32)
y = np.array(y_augmented, dtype=object)

print(f"   Total samples after augmentation: {len(X)}")

# Standardize
mean = X.mean(axis=0, keepdims=True)
std = X.std(axis=0, keepdims=True) + 1e-8
X_scaled = (X - mean) / std

# Save feature scaling parameters for inference
scaling_params = {
    'mean': mean.flatten().tolist(),
    'std': std.flatten().tolist()
}
with open(out_dir.joinpath('feature_scaling.json'), 'w', encoding='utf-8') as f:
    json.dump(scaling_params, f, indent=2)
print(f"[INFO] Saved feature scaling parameters to {out_dir.joinpath('feature_scaling.json')}")

# Analyze class distribution
label_counts = Counter(y)
print(f"\n[INFO] Class Distribution:")
for label, count in sorted(label_counts.items(), key=lambda x: x[1], reverse=True):
    print(f"  {label}: {count} samples")
print(f"Total: {len(y)}, Classes: {len(label_counts)}\n")

# Class weights
le = LabelEncoder()
y_idx = le.fit_transform(y)
y_cat = to_categorical(y_idx)

class_weights = compute_class_weight('balanced', classes=np.unique(y_idx), y=y_idx)
class_weight_dict = {i: w for i, w in enumerate(class_weights)}
print(f"[INFO] Class weights:")
for i, label in enumerate(le.classes_):
    print(f"  {label}: {class_weight_dict[i]:.3f}")
print()

# Model
num_classes = y_cat.shape[1]
input_dim = X_scaled.shape[1]

model = tf.keras.Sequential([
    tf.keras.layers.Input(shape=(input_dim,)),
    tf.keras.layers.Dense(256, activation='relu'),
    tf.keras.layers.BatchNormalization(),
    tf.keras.layers.Dropout(0.5),
    tf.keras.layers.Dense(128, activation='relu'),
    tf.keras.layers.BatchNormalization(),
    tf.keras.layers.Dropout(0.4),
    tf.keras.layers.Dense(64, activation='relu'),
    tf.keras.layers.BatchNormalization(),
    tf.keras.layers.Dropout(0.3),
    tf.keras.layers.Dense(32, activation='relu'),
    tf.keras.layers.Dropout(0.2),
    tf.keras.layers.Dense(num_classes, activation='softmax')
])

# Use ReduceLROnPlateau instead of schedule (they conflict)
optimizer = tf.keras.optimizers.Adam(learning_rate=0.003)

early_stopping = tf.keras.callbacks.EarlyStopping(
    monitor='val_accuracy',
    patience=20,
    restore_best_weights=True,
    verbose=1
)

reduce_lr = tf.keras.callbacks.ReduceLROnPlateau(
    monitor='val_loss',
    factor=0.5,
    patience=10,
    min_lr=1e-6,
    verbose=1
)

model.compile(
    optimizer=optimizer,
    loss='categorical_crossentropy',
    metrics=['accuracy', tf.keras.metrics.TopKCategoricalAccuracy(k=3, name='top3_accuracy')]
)

print(f"[INFO] Training: {input_dim} -> 256 -> 128 -> 64 -> 32 -> {num_classes}\n")

history = model.fit(
    X_scaled, y_cat,
    epochs=args.epochs,
    batch_size=args.batch_size,
    validation_split=0.2,
    class_weight=class_weight_dict,
    callbacks=[early_stopping, reduce_lr],
    verbose=1
)

# Save
model.save(str(out_dir.joinpath('color_model.h5')))
with open(out_dir.joinpath('labels.json'), 'w', encoding='utf-8') as f:
    json.dump(list(le.classes_), f, ensure_ascii=False)
with open(out_dir.joinpath('label_encoder.pkl'), 'wb') as f:
    pickle.dump(le, f)

# TFLite
converter = tf.lite.TFLiteConverter.from_keras_model(model)
if args.quantize:
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    def representative_dataset():
        for i in range(min(100, X_scaled.shape[0])):
            idx = np.random.randint(0, X_scaled.shape[0])
            yield [X_scaled[idx:idx+1].astype(np.float32)]
    converter.representative_dataset = representative_dataset

tflite_model = converter.convert()
with open(out_dir.joinpath('color_model.tflite'), 'wb') as f:
    f.write(tflite_model)

print(f"\n[SUCCESS] Saved to {out_dir}")
print(f"   Training accuracy: {history.history['accuracy'][-1]*100:.2f}%")
print(f"   Validation accuracy: {history.history['val_accuracy'][-1]*100:.2f}%")

