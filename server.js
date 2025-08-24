#!/usr/bin/env node
/**
 * MeetingNexus WebSocket Server
 * Handles real-time transcript processing and knowledge graph generation
 */

const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const path = require('path');
const OpenAI = require('openai');
require('dotenv').config();

class MeetingNexusServer {
    constructor() {
        this.port = process.env.PORT || 3001;
        this.wsPort = process.env.WS_PORT || 8765;
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        
        // Track meeting state
        this.meetingState = {
            isActive: false,
            participants: new Set(),
            currentGraph: { nodes: [], edges: [] },
            transcriptBuffer: [],
            lastProcessTime: Date.now()
        };
        
        this.setupExpressServer();
        this.setupWebSocketServer();
    }

    setupExpressServer() {
        this.app = express();
        this.app.use(cors());
        this.app.use(express.json());
        this.app.use(express.static('public'));
        
        // Serve GraphGPT frontend
        this.app.use(express.static(path.join(__dirname, 'GraphGPT/build')));
        
        // API endpoints
        this.app.get('/api/meeting/status', (req, res) => {
            res.json({
                isActive: this.meetingState.isActive,
                participants: Array.from(this.meetingState.participants),
                graphNodeCount: this.meetingState.currentGraph.nodes.length
            });
        });
        
        this.app.post('/api/meeting/clear', (req, res) => {
            this.clearMeetingState();
            this.broadcastToClients({ type: 'clear_graph' });
            res.json({ success: true });
        });
        
        // Serve main app
        this.app.get('*', (req, res) => {
            res.sendFile(path.join(__dirname, 'public/index.html'));
        });
        
        this.server = this.app.listen(this.port, () => {
            console.log(`[Server] HTTP server running on port ${this.port}`);
        });
    }

    setupWebSocketServer() {
        this.wss = new WebSocket.Server({ port: this.wsPort });
        
        console.log(`[Server] WebSocket server running on port ${this.wsPort}`);
        
        this.wss.on('connection', (ws) => {
            console.log('[Server] New WebSocket connection');
            
            // Send current meeting state to new client
            ws.send(JSON.stringify({
                type: 'meeting_state',
                data: {
                    isActive: this.meetingState.isActive,
                    graph: this.meetingState.currentGraph,
                    participants: Array.from(this.meetingState.participants)
                }
            }));
            
            ws.on('message', async (message) => {
                try {
                    const data = JSON.parse(message.toString());
                    await this.handleMessage(data, ws);
                } catch (error) {
                    console.error('[Server] Error processing message:', error);
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: 'Failed to process message' 
                    }));
                }
            });
            
            ws.on('close', () => {
                console.log('[Server] WebSocket connection closed');
            });
            
            ws.on('error', (error) => {
                console.error('[Server] WebSocket error:', error);
            });
        });
    }

    async handleMessage(data, ws) {
        switch (data.type) {
            case 'transcript':
                await this.handleTranscript(data);
                break;
            case 'start_meeting':
                this.startMeeting();
                break;
            case 'stop_meeting':
                this.stopMeeting();
                break;
            case 'clear_graph':
                this.clearMeetingState();
                this.broadcastToClients({ type: 'clear_graph' });
                break;
            default:
                console.log(`[Server] Unknown message type: ${data.type}`);
        }
    }

    async handleTranscript(data) {
        const { speaker, text, is_final, confidence } = data;
        
        // Track participants
        this.meetingState.participants.add(speaker);
        
        // Broadcast transcript to all clients
        this.broadcastToClients({
            type: 'transcript_update',
            data: {
                speaker,
                text,
                is_final,
                confidence,
                timestamp: new Date().toISOString()
            }
        });
        
        // Process final transcripts for knowledge extraction
        if (is_final && text.trim() && !text.startsWith('[')) {
            this.meetingState.transcriptBuffer.push({ speaker, text, timestamp: Date.now() });
            
            // Process accumulated transcripts every 10 seconds or 3 sentences
            const now = Date.now();
            const shouldProcess = 
                (now - this.meetingState.lastProcessTime > 10000) || 
                (this.meetingState.transcriptBuffer.length >= 3);
                
            if (shouldProcess) {
                await this.processTranscriptBuffer();
            }
        }
    }

    async processTranscriptBuffer() {
        if (this.meetingState.transcriptBuffer.length === 0) return;
        
        const transcripts = this.meetingState.transcriptBuffer.splice(0);
        this.meetingState.lastProcessTime = Date.now();
        
        console.log(`[Server] Processing ${transcripts.length} transcript segments for knowledge extraction`);
        
        try {
            const knowledge = await this.extractMeetingKnowledge(transcripts);
            if (knowledge && knowledge.length > 0) {
                this.updateMeetingGraph(knowledge);
                this.broadcastToClients({
                    type: 'graph_update',
                    data: knowledge
                });
            }
        } catch (error) {
            console.error('[Server] Error extracting knowledge:', error);
        }
    }

    async extractMeetingKnowledge(transcripts) {
        const combinedText = transcripts
            .map(t => `${t.speaker}: ${t.text}`)
            .join('\\n');

        const prompt = `Extract knowledge graph elements from this meeting transcript:
${combinedText}

Focus on:
- People mentioned (participants, clients, stakeholders)
- Topics and subjects discussed
- Decisions made
- Action items and assignments
- Problems or concerns raised
- Deadlines and dates
- Projects or initiatives

Return ONLY a JSON array of relationships in this format:
[
  ["Entity1", "relationship", "Entity2"],
  ["Entity1", "#color"]
]

Use these colors:
- People: #4CAF50 (green)
- Topics: #2196F3 (blue) 
- Decisions: #FF9800 (orange)
- Action Items: #F44336 (red)
- Deadlines: #9C27B0 (purple)

Example:
[
  ["Q3 Budget", "concerns", "Timeline"],
  ["John", "assigned", "Budget Review"],
  ["Q3 Budget", "#2196F3"],
  ["John", "#4CAF50"],
  ["Budget Review", "#F44336"]
]`;

        try {
            const response = await this.openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.3,
                max_tokens: 800
            });

            const content = response.choices[0].message.content.trim();
            console.log('[Server] OpenAI Response:', content);
            
            // Parse JSON response
            const jsonMatch = content.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            
            return [];
        } catch (error) {
            console.error('[Server] OpenAI API error:', error);
            throw error;
        }
    }

    updateMeetingGraph(updates) {
        // Mirror GraphGPT's updateGraph logic
        let currentGraph = { 
            nodes: [...this.meetingState.currentGraph.nodes],
            edges: [...this.meetingState.currentGraph.edges]
        };

        updates.forEach(update => {
            if (update.length === 3) {
                // Add relationship: [entity1, relation, entity2]
                const [entity1, relation, entity2] = update;

                // Add nodes if they don't exist
                if (!currentGraph.nodes.find(node => node.id === entity1)) {
                    currentGraph.nodes.push({ id: entity1, label: entity1, color: "#ffffff" });
                }
                if (!currentGraph.nodes.find(node => node.id === entity2)) {
                    currentGraph.nodes.push({ id: entity2, label: entity2, color: "#ffffff" });
                }

                // Add or update edge
                const existingEdge = currentGraph.edges.find(edge => 
                    edge.from === entity1 && edge.to === entity2
                );
                if (existingEdge) {
                    existingEdge.label = relation;
                } else {
                    currentGraph.edges.push({ from: entity1, to: entity2, label: relation });
                }
            } else if (update.length === 2 && update[1].startsWith("#")) {
                // Set node color: [entity, color]
                const [entity, color] = update;
                const node = currentGraph.nodes.find(node => node.id === entity);
                if (node) {
                    node.color = color;
                } else {
                    currentGraph.nodes.push({ id: entity, label: entity, color: color });
                }
            }
        });

        this.meetingState.currentGraph = currentGraph;
        console.log(`[Server] Graph updated: ${currentGraph.nodes.length} nodes, ${currentGraph.edges.length} edges`);
    }

    startMeeting() {
        this.meetingState.isActive = true;
        this.meetingState.participants.clear();
        console.log('[Server] Meeting started');
        this.broadcastToClients({ type: 'meeting_started' });
    }

    stopMeeting() {
        this.meetingState.isActive = false;
        console.log('[Server] Meeting stopped');
        this.broadcastToClients({ type: 'meeting_stopped' });
    }

    clearMeetingState() {
        this.meetingState.currentGraph = { nodes: [], edges: [] };
        this.meetingState.transcriptBuffer = [];
        this.meetingState.participants.clear();
        console.log('[Server] Meeting state cleared');
    }

    broadcastToClients(message) {
        const messageStr = JSON.stringify(message);
        this.wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(messageStr);
            }
        });
    }

    async shutdown() {
        console.log('[Server] Shutting down...');
        if (this.wss) {
            this.wss.close();
        }
        if (this.server) {
            this.server.close();
        }
    }
}

// Start server
const server = new MeetingNexusServer();

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\\n[Server] Received SIGINT, shutting down gracefully...');
    await server.shutdown();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\\n[Server] Received SIGTERM, shutting down gracefully...');
    await server.shutdown();
    process.exit(0);
});

module.exports = MeetingNexusServer;