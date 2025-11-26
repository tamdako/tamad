import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StatusBar,
  ScrollView,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { styles } from './WelcomeScreen.styles';
import { IMAGES } from '../../Images';

interface WelcomeScreenProps {
  onNext: () => void;
}

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onNext }) => {
  const FeatureRow = ({
    title,
    description,
    icon,
  }: {
    title: string;
    description: string;
    icon: string;
  }) => (
    <View style={styles.featureRow}>
      <View style={styles.featureIconWrap}>
        <Text style={styles.featureIcon}>{icon}</Text>
      </View>
      <View style={styles.featureContent}>
        <Text style={styles.featureTitle}>{title}</Text>
        <Text style={styles.featureDesc}>{description}</Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#070D0D" />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroSection}>
          <Image source={IMAGES.LOGO} style={styles.heroLogo} resizeMode="contain" />
          <Text style={styles.heroTitle}>ColorLens</Text>
          <Text style={styles.heroSubtitle}>
            Welcome to ColorLens. Your AI assistant for instant color recognition and voice feedback.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>What it Does</Text>
          <FeatureRow
            title="Real-Time Identification"
            description="Use your camera or upload an image to detect colors on the spot."
            icon="📷"
          />
          <FeatureRow
            title="Speak and See"
            description="Hear the color name aloud and view the HEX code instantly."
            icon="🔊"
          />
          <FeatureRow
            title="Color Families"
            description="Discover related shades and curated palettes."
            icon="🎨"
          />
        </View>


      </ScrollView>

      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={styles.startButton}
          onPress={onNext}
          activeOpacity={0.85}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.startButtonText}>Start Exploring</Text>
          <Text style={styles.startArrow}>→</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

export default WelcomeScreen;
