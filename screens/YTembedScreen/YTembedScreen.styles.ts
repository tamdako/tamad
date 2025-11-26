import { StyleSheet, Dimensions } from 'react-native';
const { height } = Dimensions.get('window');

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FCF8F7',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#007FFF',
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    paddingVertical: 0,
    paddingHorizontal: 0,
    marginRight: 12,
    borderRadius: 21,
    width: 42,
    height: 42,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#005FCC',
  },
  backButtonText: {
    fontSize: 16,
    color: '#3A86FF',
    fontWeight: '500',
    marginLeft: 8,
    alignSelf: 'center',
  },
  backIcon: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  backIconImage: { width: 18, height: 18, tintColor: '#fff', resizeMode: 'contain' },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FCF8F7',
    flex: 1,
  },
  videoContainer: {
    height: height * 0.4,
    margin: 20,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#F5F5F5',
  },
  webView: {
    flex: 1,
  },
  webViewFallback: { justifyContent: 'center', alignItems: 'center' },
  infoContainer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  infoTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#000000',
    marginBottom: 8,
  },
  infoDescription: {
    fontSize: 14,
    color: '#666666',
    lineHeight: 20,
  },
});