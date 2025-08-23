# MeetingNexus: Real-Time Meeting Mind Map Generator

## Overview

A rapid prototype system that transforms meeting conversations into interactive mind maps in real-time. Built using proven open-source components (GraphGPT, RealtimeSTT) connected via WebSocket updates for instant visualization as conversations unfold.

## Quick Prototype Architecture (1-2 Day Build)

```
Audio Stream → RealtimeSTT → WebSocket → GraphGPT → Live Knowledge Graph
     ↓              ↓            ↓             ↓              ↓
Live Audio    Speech-to-Text  Real-time    Knowledge      Interactive
Capture       Processing      Updates      Extraction     Visualization
```

**Key Components**:
- **RealtimeSTT**: Handles real-time speech-to-text conversion
- **GraphGPT**: Extracts knowledge graphs from transcript text AND renders visualization
- **WebSocket**: Enables instant updates between components
- **GraphGPT's Built-in Viz**: Uses the existing Cytoscape.js/vis.js visualization engine

## Component Integration Strategy

### 1. Audio Processing Layer (RealtimeSTT)

**GitHub**: https://github.com/KoljaB/RealtimeSTT  
**Role**: Real-time speech-to-text conversion with voice activity detection

**Key Features We'll Use**:
- Low-latency audio capture and transcription
- Speaker change detection
- Confidence scoring for transcript quality
- Whisper model integration for accuracy

**Quick Setup**:
```bash
pip install realtimestt[all]
# Handles audio capture, VAD, and Whisper transcription
```

**Output Format**:
```json
{
  "speaker": "Speaker_1",
  "timestamp": "2024-08-23T10:05:00Z",
  "text": "Let's discuss the Q3 budget review",
  "confidence": 0.95,
  "is_final": true
}
```

### 2. Knowledge Extraction & Visualization Layer (GraphGPT)

**GitHub**: https://github.com/varunshenoy/GraphGPT  
**Role**: Convert unstructured transcript text into knowledge graph AND render it visually

**Key Features We'll Use**:
- GPT-3/4 powered entity extraction
- Relationship identification between concepts
- Built-in graph visualization (uses Cytoscape.js or vis.js under the hood)
- Real-time graph updates and animations
- Interactive node manipulation (drag, zoom, click)

**GraphGPT's Visualization Engine**:
- Uses proven graph visualization libraries (not D3)
- Already handles node positioning and layout algorithms
- Includes interactive features out-of-the-box
- Supports incremental updates to existing graphs

**Integration Point**:
```javascript
// Modified GraphGPT function for meeting context
async function extractMeetingKnowledge(transcriptChunk) {
  const prompt = `
  Extract meeting knowledge from: "${transcriptChunk}"
  Focus on: people, topics, decisions, action items, concerns
  Format for GraphGPT visualization engine
  `;
  
  const knowledge = await callGPT(prompt);
  
  // GraphGPT handles the visualization automatically
  graphgpt.updateGraph(knowledge);
  
  return knowledge;
}
```

### 3. Real-Time Communication (WebSocket)

**Role**: Instant updates between transcript processing and visualization

**Implementation**:
```javascript
// Server-side WebSocket handler
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', (ws) => {
  // When RealtimeSTT produces transcript
  transcriptStream.on('data', async (transcript) => {
    const knowledge = await extractMeetingKnowledge(transcript.text);
    
    // Send to all connected clients immediately
    ws.send(JSON.stringify({
      type: 'GRAPH_UPDATE',
      data: knowledge,
      timestamp: transcript.timestamp
    }));
  });
});
```

### 4. GraphGPT Visualization Integration

**Base**: Use GraphGPT's existing visualization engine  
**Role**: Render and animate mind map updates in real-time using GraphGPT's built-in capabilities

**Real-Time Update Handler**:
```javascript
// Client-side WebSocket listener
const ws = new WebSocket('ws://localhost:8080');

ws.onmessage = (event) => {
  const update = JSON.parse(event.data);
  
  if (update.type === 'GRAPH_UPDATE') {
    // Use GraphGPT's built-in update mechanism
    updateGraphGPTVisualization(update.data);
  }
};

function updateGraphGPTVisualization(newData) {
  // GraphGPT handles the visualization internally
  // No need for custom D3 code - just feed it the data
  graphgpt.processUpdate(newData);
  
  // GraphGPT automatically:
  // - Merges new nodes/links with existing graph
  // - Animates changes with built-in transitions  
  // - Handles layout and positioning
}
```

## Data Flow: Real-Time Processing Pipeline

### Step 1: Audio Capture & Transcription
```
1. User speaks: "Let's discuss the Q3 budget and timeline concerns"
2. RealtimeSTT captures audio → Whisper processing → Text output
3. WebSocket sends transcript chunk to knowledge processor
```

### Step 2: Knowledge Extraction
```
4. GraphGPT receives transcript chunk
5. GPT-4 extracts entities: ["Q3 budget", "timeline concerns", "Speaker_1"]  
6. GPT-4 identifies relationships: budget → causes → timeline concerns
7. Formats as D3-compatible JSON structure
```

### Step 3: Real-Time Visualization Update
```
8. WebSocket broadcasts knowledge update to all clients
9. GraphGPT's visualization engine receives new nodes and links
10. Built-in animation system adds new concepts to existing graph
11. Users see changes within 2-3 seconds of speaking
```

## MVP Feature Set

**Core Features (Day 1-2)**:
- ✅ Real-time speech to text
- ✅ Knowledge graph extraction  
- ✅ Live graph visualization (using GraphGPT's built-in system)
- ✅ Basic speaker identification
- ✅ WebSocket real-time updates

**Nice-to-Have Extensions**:
- 📋 Action item extraction and assignment
- 🔍 Search within meeting history
- 📊 Meeting summary generation
- 💾 Export capabilities (PNG, JSON, PDF)
- 🎨 Custom themes and layouts
- 👥 Multi-meeting comparison

## File Structure:
meetingnexus/
├── server/
│   ├── app.js              # WebSocket server + Express
│   ├── realtimestt_bridge.py  # Audio processing service
│   └── graphgpt_engine.js  # Knowledge extraction
├── client/
│   ├── index.html         # Main interface (modified GraphGPT frontend)
│   ├── graphgpt.js        # GraphGPT visualization engine
│   └── websocket_client.js # Real-time updates
└── package.json

## Success Metrics

**User Experience**:
- Concepts appear within 5 seconds of being mentioned
- No missed major topics or decisions
- Smooth animations with no visual lag
- Intuitive navigation and interaction

**Technical Performance**:
- <6 second end-to-end latency
- 99% uptime during meetings
- Handles 1-hour meetings without memory issues
- WebSocket connections remain stable

## Next Steps Beyond Prototype

**Week 2-3 Improvements**:
- Add user authentication and meeting persistence
- Implement advanced NLP for better entity extraction
- Add collaborative features (multiple users, shared cursors)
- Integrate with calendar systems (Zoom, Teams, Google Meet)

**Month 2-3 Scale Up**:
- Multi-language support
- Custom domain vocabularies for specialized meetings
- Advanced analytics and meeting insights
- Mobile app development
- Enterprise integrations (Slack, Notion, Confluence)

This rapid prototype approach leverages proven open-source components to deliver a working MeetingNexus system in 1-2 days, providing a solid foundation for iterative improvement and feature expansion.