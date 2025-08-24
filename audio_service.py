#!/usr/bin/env python3
"""
MeetingNexus Audio Service
Real-time speech-to-text using RealtimeSTT with WebSocket output
"""

import asyncio
import websockets
import json
import time
import sys
import os
from datetime import datetime
import threading
from RealtimeSTT import AudioToTextRecorder

class MeetingAudioService:
    def __init__(self, websocket_host="localhost", websocket_port=8765):
        self.websocket_host = websocket_host
        self.websocket_port = websocket_port
        self.websocket = None
        self.recorder = None
        self.is_recording = False
        self.speaker_count = 1
        self.current_speaker = f"Speaker_{self.speaker_count}"
        
        # Track sentences and realtime text
        self.completed_sentences = []
        self.current_text = ""
        
        print(f"[AudioService] Initializing MeetingNexus Audio Service")
        print(f"[AudioService] Will connect to WebSocket at ws://{websocket_host}:{websocket_port}")

    async def connect_websocket(self):
        """Connect to WebSocket server"""
        try:
            self.websocket = await websockets.connect(f"ws://{self.websocket_host}:{self.websocket_port}")
            print(f"[AudioService] Connected to WebSocket server")
            return True
        except Exception as e:
            print(f"[AudioService] Failed to connect to WebSocket: {e}")
            return False

    async def send_transcript(self, text, is_final=False, confidence=0.9):
        """Send transcript data to WebSocket server"""
        if not self.websocket:
            return
            
        data = {
            "type": "transcript",
            "speaker": self.current_speaker,
            "timestamp": datetime.now().isoformat(),
            "text": text,
            "confidence": confidence,
            "is_final": is_final
        }
        
        try:
            await self.websocket.send(json.dumps(data))
            print(f"[AudioService] Sent: {self.current_speaker}: {text[:50]}{'...' if len(text) > 50 else ''}")
        except Exception as e:
            print(f"[AudioService] Error sending transcript: {e}")

    def preprocess_text(self, text):
        """Clean and preprocess transcript text"""
        text = text.lstrip()
        if text.startswith("..."):
            text = text[3:]
        text = text.lstrip()
        if text:
            text = text[0].upper() + text[1:]
        return text

    def on_realtime_text(self, text):
        """Handle real-time transcription updates (partial text)"""
        if not text.strip():
            return
            
        text = self.preprocess_text(text)
        self.current_text = text
        
        # Send partial transcript
        asyncio.create_task(self.send_transcript(text, is_final=False, confidence=0.7))

    def on_final_text(self, text):
        """Handle completed sentence transcription"""
        if not text.strip():
            return
            
        text = self.preprocess_text(text)
        text = text.rstrip()
        
        if text.endswith("..."):
            text = text[:-3].rstrip()
            
        if not text:
            return

        self.completed_sentences.append(text)
        print(f"[AudioService] Final: {self.current_speaker}: {text}")
        
        # Send final transcript
        asyncio.create_task(self.send_transcript(text, is_final=True, confidence=0.95))
        
        # Reset current text
        self.current_text = ""

    def setup_recorder(self):
        """Initialize the RealtimeSTT recorder"""
        recorder_config = {
            'spinner': False,
            'model': 'base.en',  # Balance between speed and accuracy
            'realtime_model_type': 'tiny.en',  # Fast real-time model
            'language': 'en',
            'silero_sensitivity': 0.1,
            'webrtc_sensitivity': 3,
            'post_speech_silence_duration': 0.7,
            'min_length_of_recording': 0.8,        
            'min_gap_between_recordings': 0,                
            'enable_realtime_transcription': True,
            'realtime_processing_pause': 0.02,
            'on_realtime_transcription_update': self.on_realtime_text,
            'silero_deactivity_detection': True,
            'early_transcription_on_silence': 0,
            'beam_size': 5,
            'beam_size_realtime': 3,
            'no_log_file': True,
            'initial_prompt_realtime': (
                "This is a meeting transcription. "
                "End incomplete sentences with ellipses. "
                "Focus on clear speech recognition."
            ),
            'silero_use_onnx': True,
        }
        
        print("[AudioService] Initializing RealtimeSTT recorder...")
        self.recorder = AudioToTextRecorder(**recorder_config)
        print("[AudioService] Recorder initialized successfully")

    async def start_recording(self):
        """Start audio recording and transcription"""
        if self.is_recording:
            print("[AudioService] Already recording")
            return

        if not self.recorder:
            self.setup_recorder()
            
        if not self.websocket:
            if not await self.connect_websocket():
                print("[AudioService] Cannot start recording without WebSocket connection")
                return

        self.is_recording = True
        print("[AudioService] Starting meeting recording...")
        
        # Send recording start notification
        await self.send_transcript("[Meeting Recording Started]", is_final=True, confidence=1.0)
        
        # Start recording in a separate thread
        def recording_thread():
            try:
                while self.is_recording:
                    self.recorder.text(self.on_final_text)
            except KeyboardInterrupt:
                pass
            except Exception as e:
                print(f"[AudioService] Recording error: {e}")
                
        self.recording_thread = threading.Thread(target=recording_thread)
        self.recording_thread.daemon = True
        self.recording_thread.start()

    async def stop_recording(self):
        """Stop audio recording"""
        if not self.is_recording:
            return
            
        self.is_recording = False
        print("[AudioService] Stopping recording...")
        
        if self.websocket:
            await self.send_transcript("[Meeting Recording Stopped]", is_final=True, confidence=1.0)
        
        if self.recording_thread:
            self.recording_thread.join(timeout=2)

    async def handle_commands(self):
        """Handle user commands"""
        print("\n[AudioService] Commands:")
        print("  's' - Start recording")
        print("  'q' - Stop recording and quit")
        print("  'n' - Switch to next speaker")
        print()
        
        loop = asyncio.get_event_loop()
        
        while True:
            try:
                # Read user input in a non-blocking way
                command = await loop.run_in_executor(None, input, "[AudioService] Command: ")
                command = command.strip().lower()
                
                if command == 's':
                    await self.start_recording()
                elif command == 'q':
                    await self.stop_recording()
                    break
                elif command == 'n':
                    self.speaker_count += 1
                    self.current_speaker = f"Speaker_{self.speaker_count}"
                    print(f"[AudioService] Switched to {self.current_speaker}")
                    if self.websocket:
                        await self.send_transcript(f"[Now speaking: {self.current_speaker}]", is_final=True, confidence=1.0)
                        
            except KeyboardInterrupt:
                break
            except Exception as e:
                print(f"[AudioService] Command error: {e}")

        await self.cleanup()

    async def cleanup(self):
        """Clean up resources"""
        await self.stop_recording()
        if self.websocket:
            await self.websocket.close()
        print("[AudioService] Audio service stopped")

async def main():
    """Main entry point"""
    service = MeetingAudioService()
    
    try:
        await service.handle_commands()
    except KeyboardInterrupt:
        print("\n[AudioService] Interrupted by user")
    finally:
        await service.cleanup()

if __name__ == "__main__":
    # Handle Windows event loop policy
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    
    # Initialize DLL path for Windows
    if os.name == "nt" and (3, 8) <= sys.version_info < (3, 99):
        try:
            from torchaudio._extension.utils import _init_dll_path
            _init_dll_path()    
        except ImportError:
            pass
    
    asyncio.run(main())