import wave, struct

sample_rate = 24000
duration_sec = 1.5
frequency = 440.0
amplitude = 16000

num_samples = int(sample_rate * duration_sec)
output_path = r"C:\Users\lenovo\OneDrive\Desktop\bpo-combat-arena\server\scoring\sine_test.wav"

with wave.open(output_path, 'w') as wav:
    wav.setnchannels(1)
    wav.setsampwidth(2)
    wav.setframerate(sample_rate)
    for i in range(num_samples):
        sample = int(amplitude * (1 if (i % int(sample_rate / frequency)) < (sample_rate / frequency / 2) else -1))
        wav.writeframes(struct.pack('<h', sample))

print(f"Wrote: {output_path} ({num_samples} samples)")

