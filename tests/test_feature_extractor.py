import pytest
import numpy as np
from backend.app.core.feature_extractor import extract_features, features_to_vector

def test_extract_features_sine_wave():
    # 100 Hz sine wave of amplitude 1.0 sampled at 1000 Hz for 1 second
    sample_rate = 1000
    t = np.linspace(0, 1.0, sample_rate, endpoint=False)
    freq = 100.0
    signal = 1.0 * np.sin(2 * np.pi * freq * t)

    features, spectrum = extract_features(signal, sample_rate_hz=sample_rate)

    # Theoretical RMS of sine wave with amplitude 1.0 is 1/sqrt(2) approx 0.7071
    assert abs(features["rms"] - 0.7071) < 0.02
    assert abs(features["peak"] - 1.0) < 0.05
    assert abs(features["dominant_freq"] - freq) < 2.0
    assert spectrum is not None
    assert len(spectrum) > 0

def test_extract_features_empty_window():
    features, spectrum = extract_features([], sample_rate_hz=1000)
    assert features["rms"] == 0.0
    assert features["peak"] == 0.0
    assert spectrum is None

def test_features_to_vector():
    features = {
        "rms": 0.5,
        "peak": 1.0,
        "peak_to_peak": 2.0,
        "crest_factor": 2.0,
        "kurtosis": 3.0,
        "skewness": 0.1,
        "dominant_freq": 180.0,
        "spectral_centroid": 190.0,
        "band_energies": {
            "0_50Hz": 0.01,
            "50_150Hz": 0.05,
            "150_300Hz": 0.40,
            "300_500Hz": 0.04
        }
    }
    vec = features_to_vector(features)
    assert isinstance(vec, np.ndarray)
    assert len(vec) == 12
    assert vec[0] == 0.5
    assert vec[1] == 1.0

