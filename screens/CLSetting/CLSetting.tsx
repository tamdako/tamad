import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ICONS } from '../../Images';
import { styles } from './CLSetting.styles';

interface CLSettingProps {
  onBack: () => void;
  voiceEnabled?: boolean;
  colorCodesVisible?: boolean;
  voiceMode?: 'family' | 'real' | 'disable';
  onToggleColorCodes?: (v:boolean)=>void;
  onNavigateToYT?: ()=>void;
  onNavigateToAbout?: ()=>void;
  onChangeVoiceMode?: (m:'family'|'real'|'disable')=>void;
  showFamily?: boolean;
  showRealName?: boolean;
  onToggleShowFamily?: (v:boolean)=>void;
  onToggleShowRealName?: (v:boolean)=>void;
}
const CLSetting: React.FC<CLSettingProps> = ({
  onBack,
  colorCodesVisible = true,
  voiceMode = 'family',
  onToggleColorCodes,
  onNavigateToYT,
  onNavigateToAbout,
  onChangeVoiceMode,
  showFamily = true,
  showRealName = true,
  onToggleShowFamily,
  onToggleShowRealName,
}) => {
  const insets = useSafeAreaInsets();
  const [localColorCodesVisible, setLocalColorCodesVisible] = useState<boolean>(colorCodesVisible);
  const [localVoiceMode, setLocalVoiceMode] = useState<'family'|'real'|'disable'>(voiceMode);
  const [localShowFamily, setLocalShowFamily] = useState<boolean>(showFamily);
  const [localShowRealName, setLocalShowRealName] = useState<boolean>(showRealName);
  const [fabOpen, setFabOpen] = useState<boolean>(false);
  const [dropdownOpen, setDropdownOpen] = useState<boolean>(false);

  const saveAndBack = () => {
    onToggleColorCodes && onToggleColorCodes(localColorCodesVisible);
    onToggleShowFamily && onToggleShowFamily(localShowFamily);
    onToggleShowRealName && onToggleShowRealName(localShowRealName);
    onChangeVoiceMode && onChangeVoiceMode(localVoiceMode);
    onBack();
  };

  const TogglePill = ({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) => (
    <TouchableOpacity
      style={[
        styles.togglePill,
        value ? styles.togglePillOn : styles.togglePillOff,
        value ? styles.togglePillOnDirection : styles.togglePillOffDirection,
      ]}
      activeOpacity={0.8}
      onPress={() => onChange(!value)}
    >
      <Text style={[styles.toggleText, value ? styles.toggleTextOn : styles.toggleTextOff]}>
        {value ? 'ON' : 'OFF'}
      </Text>
      <View style={[styles.toggleThumb, value ? styles.toggleThumbOn : styles.toggleThumbOff]} />
    </TouchableOpacity>
  );

  const renderVoiceLabel = () => {
    if (localVoiceMode === 'family') return 'Family Color';
    if (localVoiceMode === 'real') return 'Color Name';
    return 'Disabled';
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top || 0, paddingBottom: insets.bottom || 0 }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={saveAndBack}
          style={styles.backButton}
          hitSlop={{ top: 10, left: 10, bottom: 10, right: 10 }}
        >
          <Image source={ICONS.ARROWicon} style={styles.backIconImage} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={styles.contentContainer} style={styles.scrollView}>
        <View style={styles.settingCard}>
          <View style={styles.settingTextWrap}>
            <Text style={styles.settingTitle}>Hex Display</Text>
            <Text style={styles.settingSubtitle}>e.g., #FF5733</Text>
          </View>
          <TogglePill
            value={localColorCodesVisible}
            onChange={(v) => {
              setLocalColorCodesVisible(v);
              onToggleColorCodes && onToggleColorCodes(v);
            }}
          />
        </View>

        <View style={styles.settingCard}>
          <View style={styles.settingTextWrap}>
            <Text style={styles.settingTitle}>Color Family Display</Text>
            <Text style={styles.settingSubtitle}>e.g., Red, Blue, Pink</Text>
          </View>
          <TogglePill
            value={localShowFamily}
            onChange={(v) => {
              setLocalShowFamily(v);
              onToggleShowFamily && onToggleShowFamily(v);
            }}
          />
        </View>

        <View style={styles.settingCard}>
          <View style={styles.settingTextWrap}>
            <Text style={styles.settingTitle}>Color Name Display</Text>
            <Text style={styles.settingSubtitle}>e.g., Cerulean, Vermillion</Text>
          </View>
          <TogglePill
            value={localShowRealName}
            onChange={(v) => {
              setLocalShowRealName(v);
              onToggleShowRealName && onToggleShowRealName(v);
            }}
          />
        </View>

        <View style={styles.voiceSection}>
          <Text style={styles.voiceLabel}>Voice Feedback</Text>
          <Text style={styles.voiceHint}>Speak color as:</Text>

          <View style={styles.voiceDropdownWrap}>
            <TouchableOpacity
              style={styles.dropdownButton}
              onPress={() => setDropdownOpen((v) => !v)}
              activeOpacity={0.85}
            >
              <Text style={styles.dropdownButtonText}>{renderVoiceLabel()}</Text>
              <Text style={styles.caret}>{dropdownOpen ? '▲' : '▾'}</Text>
            </TouchableOpacity>
            {dropdownOpen && (
              <View style={styles.dropdownMenu}>
                <TouchableOpacity
                  style={styles.dropdownItem}
                  onPress={() => {
                    setLocalVoiceMode('family');
                    onChangeVoiceMode && onChangeVoiceMode('family');
                    setDropdownOpen(false);
                  }}
                >
                  <Text style={styles.dropdownItemText}>Family Color</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.dropdownItem}
                  onPress={() => {
                    setLocalVoiceMode('real');
                    onChangeVoiceMode && onChangeVoiceMode('real');
                    setDropdownOpen(false);
                  }}
                >
                  <Text style={styles.dropdownItemText}>Color Name</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.dropdownItem}
                  onPress={() => {
                    setLocalVoiceMode('disable');
                    onChangeVoiceMode && onChangeVoiceMode('disable');
                    setDropdownOpen(false);
                  }}
                >
                  <Text style={styles.dropdownItemText}>Disable</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      <View style={styles.fabContainer}>
        {fabOpen && (
          <View style={styles.fabSubmenu}>
            <TouchableOpacity
              style={styles.fabSubmenuItem}
              onPress={() => {
                setFabOpen(false);
                onNavigateToAbout && onNavigateToAbout();
              }}
            >
              <Text style={styles.fabSubmenuIcon}>?</Text>
              <Text style={styles.fabSubmenuText} numberOfLines={1} ellipsizeMode="tail">About</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.fabSubmenuItem} onPress={()=>{ setFabOpen(false); onNavigateToYT && onNavigateToYT(); }}>
              <Image source={ICONS.YTicon} style={[styles.fabSubmenuIcon, styles.fabSubmenuImageSize]} />
              <Text style={styles.fabSubmenuText} numberOfLines={1} ellipsizeMode="tail">Video Tutorial</Text>
            </TouchableOpacity>
          </View>
        )}
        <TouchableOpacity
          style={styles.fabMain}
          onPress={() => setFabOpen(v => !v)}
          activeOpacity={0.85}
        >
          <Text style={styles.fabMainIcon}>{fabOpen ? '✕' : '?'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};
export default CLSetting;