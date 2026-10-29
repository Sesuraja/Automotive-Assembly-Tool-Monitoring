// Environment configuration loaded dynamically via import.meta.env
// No hardcoded URLs in components

export const ENV = {
  API_BASE_URL: (import.meta.env.VITE_API_BASE_URL as string) || '/api/v1',
  VENDOR_API_BASE_URL:
    (import.meta.env.VITE_VENDOR_API_BASE_URL as string) ||
    'https://gateway.apertureventurestudio.com',
  VENDOR_BLE_GATEWAY_URL:
    (import.meta.env.VITE_VENDOR_BLE_GATEWAY_URL as string) ||
    'https://gateway.apertureventurestudio.com/api/v1/gateway/ble/telemetry/latest',
  VENDOR_BLE_TELEMETRY_HISTORY_URL:
    (import.meta.env.VITE_VENDOR_BLE_GATEWAY_HISTORY_URL as string) ||
    'https://gateway.apertureventurestudio.com/api/v1/gateway/ble/telemetry/history',
  VENDOR_BLE_TELEMETRY_STREAM_URL:
    (import.meta.env.VITE_VENDOR_BLE_GATEWAY_STREAM_URL as string) ||
    'https://gateway.apertureventurestudio.com/api/v1/gateway/ble/telemetry/',
  VENDOR_LIVE_VIBRATION_URL:
    (import.meta.env.VITE_VENDOR_BLE_GATEWAY_URL as string) ||
    'https://gateway.apertureventurestudio.com/api/v1/gateway/ble/telemetry/latest',
};
