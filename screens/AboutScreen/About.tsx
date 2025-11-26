import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { styles } from './About.styles';
import { IMAGES, ICONS } from '../../Images';

interface AboutProps {
  onClose: () => void;
}

const sections = [
  {
    title: 'How It Works',
    items: [
      {
        icon: '📷',
        text: 'Live Scan & Upload: Use your camera in real time or upload from Tap to Detect. Tap any area to identify a color instantly.',
      },
    ],
  },
  {
    title: 'Detailed Insights',
    items: [
      {
        icon: '🎯',
        text: 'Detailed Insights: Get Hex Codes, Color Families, and exact color names.',
      },
      {
        icon: '🔊',
        text: 'Accessibility: Hear color names spoken aloud for enhanced usability.',
      },
    ],
  },
  {
    title: 'Adjusting Your View',
    items: [
      {
        icon: '🎚️',
        text: 'Precision with Adjust Mode: When using uploaded photos, enter Adjust Mode to fine-tune your selection.',
      },
      {
        icon: '🎯',
        text: 'Target Your Color: Drag the image to position the desired color under the crosshair.',
      },
      {
        icon: '✅',
        text: "Confirm & Detect: Tap 'Done' to lock the image, then detect your color.",
      },
    ],
  },
  {
    title: 'Your Privacy Matters',
    items: [
      {
        icon: '🔒',
        text: 'Local Processing: All color sampling is done directly on-device.',
      },
      {
        icon: '🚫',
        text: 'No Server Uploads: Your images are never uploaded to any server by default.',
      },
    ],
  },
];

const About: React.FC<AboutProps> = ({ onClose }) => {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onClose}
          style={styles.backButton}
          hitSlop={{ top: 10, left: 10, bottom: 10, right: 10 }}
        >
          <Image source={ICONS.ARROWicon} style={styles.backIconImage} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>About ColorLens</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <Image source={IMAGES.LOGO} style={styles.heroLogo} resizeMode="contain" />
          <Text style={styles.appName}>ColorLens</Text>
          <Text style={styles.appSubtitle}>Your Color Assistant</Text>
        </View>

        {sections.map((section) => (
          <View key={section.title} style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {section.items.map((item, idx) => (
              <View key={`${section.title}-${idx}`} style={styles.sectionRow}>
                <Text style={styles.sectionIcon}>{item.icon}</Text>
                <Text style={styles.sectionText}>{item.text}</Text>
              </View>
            ))}
          </View>
        ))}

        <View style={styles.footer}>
          <Text style={styles.footerText}>App Version: 1.0.0</Text>
          <Text style={styles.footerText}>Copyright © 2025 ColorLens</Text>
        </View>
      </ScrollView>

      <View style={styles.ctaContainer}>
        <TouchableOpacity style={styles.ctaButton} onPress={onClose} activeOpacity={0.85}>
          <Text style={styles.ctaText}>Got It!</Text>
          <Text style={styles.ctaCheck}>✓</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

export default About;

