import numpy as np
from scipy import stats
from typing import Dict, Any, List, Tuple, Optional

def extract_features(
    window: List[float] | np.ndarray,
    sample_rate_hz: int = 1000,
    compute_spectrum: bool = True
) -> Tuple[Dict[str, Any], Optional[List[Dict[str, float]]]]:
    """
    Extracts time-domain and frequency-domain vibration features from a signal window.
    Shared identically between training pipelines and live streaming inference.
    Executes in < 5ms for 1000 samples.
    """
    data = np.asarray(window, dtype=np.float64)
    if len(data) == 0:
        return {
            "rms": 0.0,
            "peak": 0.0,
            "peak_to_peak": 0.0,
            "crest_factor": 1.0,
            "kurtosis": 0.0,
            "skewness": 0.0,
            "dominant_freq": 0.0,
            "spectral_centroid": 0.0,
            "band_energies": {"0_50Hz": 0.0, "50_150Hz": 0.0, "150_300Hz": 0.0, "300_500Hz": 0.0}
        }, None

    # Remove DC bias for vibration analysis
    data_detrended = data - np.mean(data)
    
    # 1. Time-Domain Features
    rms = float(np.sqrt(np.mean(data_detrended ** 2)))
    peak = float(np.max(np.abs(data_detrended)))
    peak_to_peak = float(np.max(data_detrended) - np.min(data_detrended))
    crest_factor = float(peak / rms) if rms > 1e-6 else 1.0
    
    # Kurtosis & Skewness
    kurt = float(stats.kurtosis(data_detrended, fisher=True)) if len(data_detrended) > 3 else 0.0
    skew = float(stats.skew(data_detrended)) if len(data_detrended) > 2 else 0.0
    
    # 2. Frequency-Domain Features (FFT)
    n = len(data_detrended)
    fft_vals = np.fft.rfft(data_detrended)
    fft_mag = np.abs(fft_vals) / (n / 2.0)
    freqs = np.fft.rfftfreq(n, d=1.0 / sample_rate_hz)
    
    # Exclude DC frequency index 0
    if len(freqs) > 1:
        mag_ac = fft_mag[1:]
        freqs_ac = freqs[1:]
        
        # Dominant Frequency
        dom_idx = np.argmax(mag_ac)
        dominant_freq = float(freqs_ac[dom_idx])
        
        # Spectral Centroid
        sum_mag = np.sum(mag_ac)
        if sum_mag > 1e-6:
            spectral_centroid = float(np.sum(freqs_ac * mag_ac) / sum_mag)
        else:
            spectral_centroid = 0.0
            
        # Band energies (configurable bands)
        # e.g., low-motor 0-50Hz, running harmonics 50-150Hz, exciter band 150-300Hz, high freq 300-500Hz
        band_energies = {
            "0_50Hz": float(np.sum(mag_ac[(freqs_ac >= 0) & (freqs_ac < 50)] ** 2)),
            "50_150Hz": float(np.sum(mag_ac[(freqs_ac >= 50) & (freqs_ac < 150)] ** 2)),
            "150_300Hz": float(np.sum(mag_ac[(freqs_ac >= 150) & (freqs_ac < 300)] ** 2)),
            "300_500Hz": float(np.sum(mag_ac[(freqs_ac >= 300) & (freqs_ac <= 500)] ** 2)),
        }
    else:
        dominant_freq = 0.0
        spectral_centroid = 0.0
        band_energies = {"0_50Hz": 0.0, "50_150Hz": 0.0, "150_300Hz": 0.0, "300_500Hz": 0.0}

    features = {
        "rms": round(rms, 4),
        "peak": round(peak, 4),
        "peak_to_peak": round(peak_to_peak, 4),
        "crest_factor": round(crest_factor, 4),
        "kurtosis": round(kurt, 4),
        "skewness": round(skew, 4),
        "dominant_freq": round(dominant_freq, 2),
        "spectral_centroid": round(spectral_centroid, 2),
        "band_energies": {k: round(v, 4) for k, v in band_energies.items()}
    }

    spectrum_summary = None
    if compute_spectrum and len(freqs) > 1:
        # Downsample spectrum to ~30 bins for responsive frontend rendering
        num_bins = 32
        max_f = min(500.0, sample_rate_hz / 2.0)
        bin_edges = np.linspace(0, max_f, num_bins + 1)
        spectrum_summary = []
        for i in range(num_bins):
            f_low = bin_edges[i]
            f_high = bin_edges[i + 1]
            mask = (freqs >= f_low) & (freqs < f_high)
            bin_val = float(np.mean(fft_mag[mask])) if np.any(mask) else 0.0
            spectrum_summary.append({
                "freq": round(float((f_low + f_high) / 2.0), 1),
                "magnitude": round(bin_val, 4)
            })

    return features, spectrum_summary

def features_to_vector(features: Dict[str, Any]) -> np.ndarray:
    """
    Standardized feature vector serialization for model training and inference.
    Features: [rms, peak, peak_to_peak, crest_factor, kurtosis, skewness, dominant_freq, spectral_centroid, band_0_50, band_50_150, band_150_300, band_300_500]
    """
    bands = features.get("band_energies") or {}
    return np.array([
        float(features.get("rms") or 0.0),
        float(features.get("peak") or 0.0),
        float(features.get("peak_to_peak") or 0.0),
        float(features.get("crest_factor") or 1.0),
        float(features.get("kurtosis") or 0.0),
        float(features.get("skewness") or 0.0),
        float(features.get("dominant_freq") or 0.0),
        float(features.get("spectral_centroid") or 0.0),
        float(bands.get("0_50Hz") or 0.0),
        float(bands.get("50_150Hz") or 0.0),
        float(bands.get("150_300Hz") or 0.0),
        float(bands.get("300_500Hz") or 0.0),
    ], dtype=np.float64)
