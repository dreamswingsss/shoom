import { View, Text, StyleSheet } from 'react-native';

export default function AIAssistantScreen() {
  return (
    <View style={styles.container}>
      <Text>AI Stylist</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
