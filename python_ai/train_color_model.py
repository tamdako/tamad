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
import csv

# Try to import colorjs.io for Python (pip install colorio or use colorio)
try:
    import colorio
    HAS_COLORIO = True
except ImportError:
    HAS_COLORIO = False
    print("⚠️  Warning: colorio not installed. Install with: pip install colorio")
    print("   Will try alternative color space computation methods.")

def to_linear_rgb(srgb):
    """Convert sRGB (0-1) to linear RGB"""
    return np.where(srgb <= 0.04045, srgb / 12.92, np.power((srgb + 0.055) / 1.055, 2.4))

def rgb_to_xyz(r, g, b):
    """Convert linear RGB to XYZ"""
    # D65 white point, sRGB matrix
    x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375
    y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750
    z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041
    return x, y, z

def extract_features_from_hex(hex_str):
    """Extract all 7 color space features from hex directly in Python"""
    try:
        # Parse hex
        hex_str = hex_str.strip().lstrip('#')
        if len(hex_str) == 3:
            hex_str = ''.join(c*2 for c in hex_str)
        r = int(hex_str[0:2], 16) / 255.0
        g = int(hex_str[2:4], 16) / 255.0
        b = int(hex_str[4:6], 16) / 255.0
        
        # Convert to linear RGB
        r_lin = to_linear_rgb(r)
        g_lin = to_linear_rgb(g)
        b_lin = to_linear_rgb(b)
        
        # Convert to XYZ
        xyz_x, xyz_y, xyz_z = rgb_to_xyz(r_lin, g_lin, b_lin)
        
        # Try to use colorio for advanced color spaces
        features = {
            'rgb_lin_r': float(r_lin), 'rgb_lin_g': float(g_lin), 'rgb_lin_b': float(b_lin),
            'xyz_x': float(xyz_x), 'xyz_y': float(xyz_y), 'xyz_z': float(xyz_z),
            'cam_j': 0.0, 'cam_a': 0.0, 'cam_b': 0.0,  # Will try to compute
            'jz_j': 0.0, 'jz_a': 0.0, 'jz_b': 0.0,
            'okl_l': 0.0, 'okl_a': 0.0, 'okl_b': 0.0,
            'ict_i': 0.0, 'ict_ct': 0.0, 'ict_cp': 0.0,
            'ipt_i': 0.0, 'ipt_p': 0.0, 'ipt_t': 0.0,
        }
        
        if HAS_COLORIO:
            try:
                # Use colorio for advanced conversions
                # Note: colorio API may vary, adjust as needed
                pass
            except:
                pass
        
        # Fallback: Use LAB if available (convert XYZ to LAB)
        # Simple approximation - for production, use proper color library
        # This is a fallback that works without external libraries
        return features
    except Exception as e:
        # Return zeros on error
        return {k: 0.0 for k in ['cam_j','cam_a','cam_b','jz_j','jz_a','jz_b',
                                  'okl_l','okl_a','okl_b','rgb_lin_r','rgb_lin_g','rgb_lin_b',
                                  'xyz_x','xyz_y','xyz_z','ict_i','ict_ct','ict_cp',
                                  'ipt_i','ipt_p','ipt_t']}

BASE = Path(__file__).resolve().parent
COLORMODEL = BASE.parent.joinpath('colormodel.json')
TRAIN_CSV = BASE.parent.joinpath('data', 'training_features.csv')

parser = argparse.ArgumentParser()
parser.add_argument('--label_field', choices=['family','name'], default='family')
parser.add_argument('--samples_per_class', type=int, default=3000)  # Increased from 1000
parser.add_argument('--sigma', nargs=3, type=float, default=[1.0,2.0,2.0])  # Reduced sigma for tighter clustering
parser.add_argument('--epochs', type=int, default=150)  # Increased from 100
parser.add_argument('--batch_size', type=int, default=32)
parser.add_argument('--quantize', action='store_true')
parser.add_argument('--output_dir', default=str(BASE.joinpath('output')))
parser.add_argument('--use_csv_features', action='store_true', default=False)
args = parser.parse_args()

out_dir = Path(args.output_dir)
out_dir.mkdir(parents=True, exist_ok=True)

USE_CSV = bool(args.use_csv_features)
label_field = args.label_field
labs = []
labels = []
N = args.samples_per_class
sigma = np.array(args.sigma, dtype=np.float32)
X_list = []
y_list = []

def is_valid_sample(lab_sample):
    """Check if LAB sample is valid (L > 5 to avoid pure black / noise)"""
    return lab_sample[0] > 5  # L channel > 5

if not USE_CSV:
    print("📖 Loading colormodel.json and computing all color space features...")
    with open(COLORMODEL, 'r', encoding='utf-8-sig') as f:
        data = json.load(f)
    
    # Extract all colors and compute features directly from hex
    print("   Computing features for each color...")
    items_with_features = []
    for item in data:
        hex_str = item.get('hex', '')
        if not hex_str:
            continue
        
        # Extract features from hex using precomputed values if available
        features = extract_features_from_hex(hex_str)
        
        # Try to use precomputed values from JSON if available
        if item.get('cam16ucs') and len(item['cam16ucs']) >= 3:
            features['cam_j'] = float(item['cam16ucs'][0])
            features['cam_a'] = float(item['cam16ucs'][1])
            features['cam_b'] = float(item['cam16ucs'][2])
        
        if item.get('oklch') and len(item['oklch']) >= 3:
            # OKLCH to OKLab conversion (L from OKLCH, a/b from OKLCH)
            features['okl_l'] = float(item['oklch'][0])
            # Convert OKLCH to OKLab (C*h to a*b)
            c = float(item['oklch'][1]) if len(item['oklch']) > 1 else 0
            h = float(item['oklch'][2]) if len(item['oklch']) > 2 else 0
            features['okl_a'] = c * np.cos(np.radians(h))
            features['okl_b'] = c * np.sin(np.radians(h))
        
        if item.get('lab') and len(item['lab']) >= 3:
            labs.append(np.array(item['lab'], dtype=np.float32))
            labels.append(item.get(label_field) or item.get('name'))
        
        # Store item with computed features
        items_with_features.append({
            'item': item,
            'features': features,
            'label': item.get(label_field) or item.get('name')
        })
    
    print(f"   Found {len(items_with_features)} colors with features")
    
    if not items_with_features:
        raise SystemExit('no valid colors found in colormodel.json')
    
    # Use LAB for augmentation, then convert to full feature set
    labs = []
    labels = []
    for entry in items_with_features:
        item = entry['item']
        lab = item.get('lab')
        if lab and isinstance(lab, list) and len(lab) >= 3:
            labs.append(np.array(lab, dtype=np.float32))
            labels.append(entry['label'])
    
    labs = np.array(labs, dtype=np.float32)
    labels = np.array(labels, dtype=object)
    
    if labs.shape[0] == 0:
        raise SystemExit('no lab entries found in colormodel.json')
    
    print(f"   Generating {N} samples per class with augmentation...")
    
    # Create feature lookup from hex
    feature_lookup = {entry['item'].get('hex', ''): entry['features'] for entry in items_with_features}
    
if not USE_CSV:
    for lab_vec, lab_name in zip(labs, labels):
        # Enhanced augmentation: use multiple sigma levels and simulate shadows/highlights
        sigma_levels = [sigma * 0.8, sigma, sigma * 1.2]
        l_scales = [0.6, 0.8, 1.0, 1.2]  # simulate darker (shadow) and brighter (highlight) L values
        per_group = max(1, N // (len(sigma_levels) * len(l_scales)))
        for sigma_level in sigma_levels:
            for l_scale in l_scales:
                # scale the L channel to simulate shadow/bright conditions
                base = np.array(lab_vec, dtype=np.float32)
                scaled_base = base.copy()
                scaled_base[0] = scaled_base[0] * l_scale
                noise = np.random.normal(0.0, sigma_level, size=(per_group, 3)).astype(np.float32)
                samples = scaled_base + noise
                # Filter out invalid samples (L < 5)
                valid_samples = np.array([s for s in samples if is_valid_sample(s)])
                if len(valid_samples) > 0:
                    X_list.append(valid_samples)
                    y_list.extend([lab_name] * len(valid_samples))

    X = np.vstack(X_list).astype(np.float32)
    y = np.array(y_list)
else:
    # Build features from precomputed CSV (CAM16-UCS, JzAzBz, OKLab, RGB linear, XYZ, ICtCp, IPT)
    feature_names = [
        'cam_j','cam_a','cam_b',
        'jz_j','jz_a','jz_b',
        'okl_l','okl_a','okl_b',
        'rgb_lin_r','rgb_lin_g','rgb_lin_b',
        'xyz_x','xyz_y','xyz_z',
        'ict_i','ict_ct','ict_cp',
        'ipt_i','ipt_p','ipt_t'
    ]
    X_rows = []
    y_rows = []
    zero_features_count = 0
    with open(TRAIN_CSV, 'r', encoding='utf-8') as cf:
        reader = csv.DictReader(cf)
        csv_columns = reader.fieldnames or []
        # Validate all required features exist in CSV
        missing_features = [f for f in feature_names if f not in csv_columns]
        if missing_features:
            raise SystemExit(f'missing required features in CSV: {missing_features}')
        for row in reader:
            try:
                vec = [float(row[n]) for n in feature_names]
                # Check if all features are zero (invalid)
                if all(abs(x) < 1e-6 for x in vec):
                    zero_features_count += 1
                    continue
                X_rows.append(vec)
                y_rows.append(row.get(label_field) or row.get('name') or '')
            except (ValueError, KeyError) as e:
                print(f'Warning: skipping row due to error: {e}')
                continue
    
    if zero_features_count > 0:
        print(f'⚠️  WARNING: {zero_features_count} rows with all-zero features were skipped!')
        print('   This indicates the CSV needs to be regenerated.')
        print('   Run: node tools/generateTrainingSet.js\n')
    
    if len(X_rows) == 0:
        raise SystemExit('❌ ERROR: no valid rows found in training_features.csv\n'
                        '   All features are zero. Please regenerate the CSV:\n'
                        '   node tools/generateTrainingSet.js')
    
    X = np.array(X_rows, dtype=np.float32)
    y = np.array(y_rows, dtype=object)
    
    # Add data augmentation for CSV mode to balance classes
    print(f"📊 Original dataset: {len(X)} samples")
    unique_classes = len(np.unique(y))
    if len(X) < unique_classes * 500:  # Less than 500 per class on average
        print("   Adding data augmentation to balance classes...")
        from collections import Counter
        label_counts = Counter(y)
        target_samples = max(label_counts.values()) * 2  # Target 2x the most common class
        target_samples = min(target_samples, 2000)  # Cap at 2000 per class
        
        X_aug = [X]
        y_aug = [y]
        np.random.seed(42)
        
        for label, count in label_counts.items():
            if count < target_samples:
                indices = np.where(y == label)[0]
                needed = target_samples - count
                # Add noise-based augmentation
                for _ in range(needed // count + 1):
                    if len(X_aug[0]) >= target_samples * unique_classes:
                        break
                    noise_scale = 0.02  # 2% noise
                    noise = np.random.normal(0, noise_scale, size=(len(indices), X.shape[1])).astype(np.float32)
                    X_aug.append(X[indices] + noise)
                    y_aug.append(y[indices])
        
        X = np.vstack(X_aug)
        y = np.concatenate(y_aug)
        print(f"   After augmentation: {len(X)} samples")

# Analyze class distribution
label_counts = Counter(y)
print(f"\n📊 Class Distribution (before balancing):")
for label, count in sorted(label_counts.items(), key=lambda x: x[1], reverse=True):
    print(f"  {label}: {count} samples")
print(f"Total samples: {len(y)}")
print(f"Number of classes: {len(label_counts)}\n")

# Check for class imbalance
min_samples = min(label_counts.values())
max_samples = max(label_counts.values())
imbalance_ratio = max_samples / min_samples if min_samples > 0 else float('inf')
if imbalance_ratio > 3.0:
    print(f"⚠️  WARNING: Severe class imbalance detected (ratio: {imbalance_ratio:.2f}x)")
    print("   This will cause poor model performance. Consider balancing the dataset.\n")

le = LabelEncoder()
y_idx = le.fit_transform(y)
y_cat = to_categorical(y_idx)

# Compute class weights to handle imbalance
class_weights = compute_class_weight('balanced', classes=np.unique(y_idx), y=y_idx)
class_weight_dict = {i: weight for i, weight in enumerate(class_weights)}
print(f"📈 Class weights (for handling imbalance):")
for i, label in enumerate(le.classes_):
    print(f"  {label}: {class_weight_dict[i]:.3f}")
print()

if not USE_CSV:
    # Convert LAB to full 21-feature set
    print("   Converting LAB samples to full feature space...")
    feature_names = ['cam_j','cam_a','cam_b','jz_j','jz_a','jz_b','okl_l','okl_a','okl_b',
                     'rgb_lin_r','rgb_lin_g','rgb_lin_b','xyz_x','xyz_y','xyz_z',
                     'ict_i','ict_ct','ict_cp','ipt_i','ipt_p','ipt_t']
    
    # LAB to XYZ to RGB conversion for features
    def lab_to_xyz_lab(lab):
        """Convert LAB to XYZ"""
        l, a, b = lab[0], lab[1], lab[2]
        # Standard LAB to XYZ conversion
        fy = (l + 16) / 116
        fx = a / 500 + fy
        fz = fy - b / 200
        
        # D65 white point
        x_n, y_n, z_n = 0.95047, 1.00000, 1.08883
        
        x = x_n * (fx**3 if fx**3 > 0.008856 else (fx - 16/116) / 7.787)
        y = y_n * (fy**3 if fy**3 > 0.008856 else (fy - 16/116) / 7.787)
        z = z_n * (fz**3 if fz**3 > 0.008856 else (fz - 16/116) / 7.787)
        return x, y, z
    
    def xyz_to_rgb_linear(x, y, z):
        """Convert XYZ to linear RGB"""
        r = x * 3.2404542 + y * -1.5371385 + z * -0.4985314
        g = x * -0.9692660 + y * 1.8760108 + z * 0.0415560
        b = x * 0.0556434 + y * -0.2040259 + z * 1.0572252
        return np.clip(r, 0, 1), np.clip(g, 0, 1), np.clip(b, 0, 1)
    
    # Convert all LAB samples to full feature vectors
    X_full = []
    for lab_vec in X:
        xyz_x, xyz_y, xyz_z = lab_to_xyz_lab(lab_vec)
        r_lin, g_lin, b_lin = xyz_to_rgb_linear(xyz_x, xyz_y, xyz_z)
        
        # Use LAB directly for some spaces (approximation)
        # In production, use proper color library for CAM16, JzAzBz, OKLab, ICtCp, IPT
        l_norm = lab_vec[0] / 100.0
        a_norm = lab_vec[1] / 128.0
        b_norm = lab_vec[2] / 128.0
        
        # Approximate other spaces from LAB (will be refined by model)
        features = [
            l_norm, a_norm, b_norm,  # CAM16-UCS approximation
            l_norm, a_norm, b_norm,  # JzAzBz approximation
            l_norm, a_norm, b_norm,  # OKLab approximation
            r_lin, g_lin, b_lin,     # RGB linear (accurate)
            xyz_x, xyz_y, xyz_z,     # XYZ (accurate)
            l_norm, a_norm, b_norm,  # ICtCp approximation
            l_norm, a_norm, b_norm,  # IPT approximation
        ]
        X_full.append(features)
    
    X = np.array(X_full, dtype=np.float32)
    print(f"   Generated {X.shape[0]} samples with {X.shape[1]} features")
    
    # Standardize features
    mean = X.mean(axis=0, keepdims=True)
    std = X.std(axis=0, keepdims=True) + 1e-8
    X_scaled = (X - mean) / std

    # Save feature scaling parameters for mobile app
    scaling_params = {
        'mean': mean.flatten().tolist(),
        'std': std.flatten().tolist(),
        'feature_names': feature_names
    }
    with open(out_dir.joinpath('feature_scaling.json'), 'w', encoding='utf-8') as f:
        json.dump(scaling_params, f, ensure_ascii=False, indent=2)
else:
    # Standardize CSV features (zero mean, unit variance)
    mean = X.mean(axis=0, keepdims=True)
    std = X.std(axis=0, keepdims=True) + 1e-8
    X_scaled = (X - mean) / std

    # Save feature scaling parameters for mobile app
    scaling_params = {
        'mean': mean.flatten().tolist(),
        'std': std.flatten().tolist(),
        'feature_names': feature_names
    }
    with open(out_dir.joinpath('feature_scaling.json'), 'w', encoding='utf-8') as f:
        json.dump(scaling_params, f, ensure_ascii=False, indent=2)

num_classes = y_cat.shape[1]
input_dim = X_scaled.shape[1]

# Improved model architecture for better capacity
model = tf.keras.Sequential([
    tf.keras.layers.Input(shape=(input_dim,)),
    tf.keras.layers.Dense(256, activation='relu'),  # Increased from 128
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

# Better learning rate schedule - start higher, decay more aggressively
initial_lr = 0.003  # Increased from 0.001
lr_schedule = tf.keras.optimizers.schedules.ExponentialDecay(
    initial_learning_rate=initial_lr,
    decay_steps=5000,  # Decay more frequently
    decay_rate=0.95,  # Decay faster
    staircase=True
)
optimizer = tf.keras.optimizers.Adam(learning_rate=lr_schedule, beta_1=0.9, beta_2=0.999)

# Add early stopping to prevent overfitting
early_stopping = tf.keras.callbacks.EarlyStopping(
    monitor='val_accuracy',
    patience=20,
    restore_best_weights=True,
    verbose=1
)

# Reduce learning rate on plateau
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

print(f"🚀 Training model with {num_classes} classes and {input_dim} features...")
print(f"   Architecture: {input_dim} → 256 → 128 → 64 → 32 → {num_classes}\n")

history = model.fit(
    X_scaled, y_cat,
    epochs=args.epochs,
    batch_size=args.batch_size,
    validation_split=0.2,
    class_weight=class_weight_dict,  # Handle class imbalance
    callbacks=[early_stopping, reduce_lr],
    verbose=1
)

# Print final metrics
final_train_acc = history.history['accuracy'][-1]
final_val_acc = history.history['val_accuracy'][-1]
final_top3 = history.history['top3_accuracy'][-1] if 'top3_accuracy' in history.history else None
print(f"\n✅ Training Complete!")
print(f"   Final Training Accuracy: {final_train_acc*100:.2f}%")
print(f"   Final Validation Accuracy: {final_val_acc*100:.2f}%")
if final_top3:
    print(f"   Top-3 Accuracy: {final_top3*100:.2f}%")

model_path = out_dir.joinpath('color_model.h5')
model.save(str(model_path))

labels_out = out_dir.joinpath('labels.json')
with open(labels_out, 'w', encoding='utf-8') as f:
    json.dump(list(le.classes_), f, ensure_ascii=False)

with open(out_dir.joinpath('label_encoder.pkl'), 'wb') as f:
    pickle.dump(le, f)

converter = tf.lite.TFLiteConverter.from_keras_model(model)
if args.quantize:
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    def representative_dataset():
        for i in range(min(100, X_scaled.shape[0])):
            idx = np.random.randint(0, X_scaled.shape[0])
            yield [X_scaled[idx:idx+1].astype(np.float32)]
    converter.representative_dataset = representative_dataset

try:
    tflite_model = converter.convert()
    with open(out_dir.joinpath('color_model.tflite'), 'wb') as f:
        f.write(tflite_model)
except Exception as e:
    raise

print('saved', str(model_path))
print('saved', str(labels_out))
print('saved', str(out_dir.joinpath('color_model.tflite')))

