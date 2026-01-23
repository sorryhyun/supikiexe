import { useRef, useCallback, useEffect } from "react";
import type { Emotion } from "../emotion";

// Import sound files
import goodSound from "../resources/good.wav";
import euSound from "../resources/eu.wav";
import ueSound from "../resources/ue.wav";
import dontpushSound from "../resources/dontpush.wav";
import ganbattaSound from "../resources/ganbatta.wav";

export type SupikiSoundTrigger = "click" | "emotion";

interface UseSupikiSoundsReturn {
  playClickSound: () => void;
  playEmotionSound: (emotion: Emotion) => void;
  playCompletionSound: () => void;
}

export function useSupikiSounds(): UseSupikiSoundsReturn {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastEmotionRef = useRef<Emotion>("neutral");

  // Initialize audio element
  useEffect(() => {
    audioRef.current = new Audio();

    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const playSound = useCallback((soundUrl: string) => {
    if (!audioRef.current) return;

    // Stop any currently playing sound
    audioRef.current.pause();
    audioRef.current.currentTime = 0;

    // Play new sound
    audioRef.current.src = soundUrl;
    audioRef.current.play().catch((err) => {
      console.warn("Failed to play sound:", err);
    });
  }, []);

  // Play sound when clicked - randomly pick between "ue.wav" and "eu.wav"
  const playClickSound = useCallback(() => {
    const sounds = [ueSound, euSound];
    const randomSound = sounds[Math.floor(Math.random() * sounds.length)];
    playSound(randomSound);
  }, [playSound]);

  // Play sound based on emotion
  const playEmotionSound = useCallback((emotion: Emotion) => {
    // Only play if emotion changed
    if (emotion === lastEmotionRef.current) return;
    lastEmotionRef.current = emotion;

    // Map emotions to sounds:
    // - happy, excited -> good.wav
    // - sad, confused -> dontpush.wav (sad/angry)
    // - others: no sound
    switch (emotion) {
      case "happy":
      case "excited":
        playSound(goodSound);
        break;
      case "sad":
      case "confused": // treating confused as "angry/frustrated"
        playSound(dontpushSound);
        break;
      default:
        // No sound for neutral, thinking, surprised, curious
        break;
    }
  }, [playSound]);

  // Play sound when agent completes (ganbatta = "you did your best!")
  const playCompletionSound = useCallback(() => {
    playSound(ganbattaSound);
  }, [playSound]);

  return {
    playClickSound,
    playEmotionSound,
    playCompletionSound,
  };
}
