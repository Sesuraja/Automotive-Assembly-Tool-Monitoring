// Environment configuration loaded dynamically via import.meta.env
// No hardcoded URLs in components

export const ENV = {
  API_BASE_URL: (import.meta.env.VITE_API_BASE_URL as string) || '/api/v1',
  VENDOR_API_BASE_URL:
    (import.meta.env.VITE_VENDOR_API_BASE_URL as string) ||
    'https://ais-dev-xzxljhsxlkzopqgvxgcwvc-509615976446.asia-southeast1.run.app',
  VENDOR_BLE_GATEWAY_URL:
    (import.meta.env.VITE_VENDOR_BLE_GATEWAY_URL as string) ||
    `${((import.meta.env.VITE_VENDOR_API_BASE_URL as string) || 'https://ais-dev-xzxljhsxlkzopqgvxgcwvc-509615976446.asia-southeast1.run.app').replace(/\/+$/, '')}/api/simulation/hardware`,
  VENDOR_LIVE_VIBRATION_URL:
    `${((import.meta.env.VITE_VENDOR_API_BASE_URL as string) || 'https://ais-dev-xzxljhsxlkzopqgvxgcwvc-509615976446.asia-southeast1.run.app').replace(/\/+$/, '')}/api/vibration/live`,
};
