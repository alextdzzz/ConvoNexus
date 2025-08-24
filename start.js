#!/usr/bin/env node
/**
 * MeetingNexus Unified Startup Script
 * Runs all components from a single terminal
 */

const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

class MeetingNexusLauncher {
    constructor() {
        this.processes = {};
        this.isShuttingDown = false;
        
        // Colors for console output
        this.colors = {
            reset: '\x1b[0m',
            bright: '\x1b[1m',
            red: '\x1b[31m',
            green: '\x1b[32m',
            yellow: '\x1b[33m',
            blue: '\x1b[34m',
            magenta: '\x1b[35m',
            cyan: '\x1b[36m'
        };
        
        console.log(`${this.colors.cyan}${this.colors.bright}🎯 MeetingNexus Launcher${this.colors.reset}`);
        console.log('Starting all components...\n');
        
        this.checkPrerequisites();
        this.setupSignalHandlers();
        this.startComponents();
    }

    log(component, message, color = 'reset') {
        const timestamp = new Date().toLocaleTimeString();
        const colorCode = this.colors[color] || this.colors.reset;
        console.log(`${colorCode}[${timestamp}] [${component}] ${message}${this.colors.reset}`);
    }

    checkPrerequisites() {
        this.log('LAUNCHER', 'Checking prerequisites...', 'yellow');
        
        // Check if .env exists
        if (!fs.existsSync('.env')) {
            this.log('LAUNCHER', 'Warning: .env file not found. Copy .env.example to .env and add your OpenAI API key.', 'red');
        }
        
        // Check Node.js dependencies
        if (!fs.existsSync('node_modules')) {
            this.log('LAUNCHER', 'Error: Node.js dependencies not installed. Run: npm install', 'red');
            process.exit(1);
        }
        
        this.log('LAUNCHER', 'Prerequisites check completed', 'green');
    }

    startComponents() {
        // Start WebSocket server
        this.startWebSocketServer();
        
        // Wait 2 seconds then start audio service
        setTimeout(() => {
            this.startAudioService();
        }, 2000);
        
        // Wait 3 seconds then open browser
        setTimeout(() => {
            this.openBrowser();
        }, 3000);
        
        // Show usage instructions
        setTimeout(() => {
            this.showInstructions();
        }, 4000);
    }

    startWebSocketServer() {
        this.log('SERVER', 'Starting WebSocket server...', 'blue');
        
        const serverProcess = spawn('node', ['server.js'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: process.cwd()
        });
        
        this.processes.server = serverProcess;
        
        serverProcess.stdout.on('data', (data) => {
            const message = data.toString().trim();
            if (message) {
                this.log('SERVER', message, 'blue');
            }
        });
        
        serverProcess.stderr.on('data', (data) => {
            const message = data.toString().trim();
            if (message && !message.includes('DeprecationWarning')) {
                this.log('SERVER', `Error: ${message}`, 'red');
            }
        });
        
        serverProcess.on('close', (code) => {
            if (!this.isShuttingDown) {
                this.log('SERVER', `Process exited with code ${code}`, 'red');
                this.shutdown();
            }
        });
    }

    startAudioService() {
        this.log('AUDIO', 'Starting audio service...', 'green');
        
        // Try multiple Python commands for Windows compatibility
        const pythonCmds = process.platform === 'win32' ? 
            [['py'], ['py', '-3'], ['python3'], ['python']] : 
            [['python3'], ['python']];
        
        this.tryPythonCommands(pythonCmds, 0);
    }

    tryPythonCommands(commands, index) {
        if (index >= commands.length) {
            this.log('AUDIO', 'Error: Python not found. Please install Python 3.8+ or add it to PATH', 'red');
            this.log('AUDIO', 'Windows users: Install from python.org or Microsoft Store', 'yellow');
            return;
        }

        const pythonCmd = commands[index];
        const cmdDisplay = Array.isArray(pythonCmd) ? pythonCmd.join(' ') : pythonCmd;
        this.log('AUDIO', `Trying Python command: ${cmdDisplay}`, 'yellow');
        
        const [executable, ...args] = Array.isArray(pythonCmd) ? pythonCmd : [pythonCmd];
        const audioProcess = spawn(executable, [...args, 'audio_service.py'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: process.cwd()
        });
        
        this.processes.audio = audioProcess;
        
        // Handle successful startup
        let hasStarted = false;
        audioProcess.stdout.on('data', (data) => {
            const message = data.toString().trim();
            // Filter out downloading and initialization messages
            const isNoise = message.includes('WARNING') || 
                           message.includes('FutureWarning') ||
                           message.includes('Downloading:') ||
                           message.includes('to C:\\Users\\') ||
                           message.includes('.cache\\torch');
                           
            if (message && !isNoise) {
                this.log('AUDIO', message, 'green');
                hasStarted = true;
            }
        });
        
        audioProcess.stderr.on('data', (data) => {
            const message = data.toString().trim();
            // Filter out common warnings and info messages
            const isWarning = message.includes('WARNING') || 
                             message.includes('FutureWarning') || 
                             message.includes('torch') ||
                             message.includes('UserWarning') ||
                             message.includes('pkg_resources') ||
                             message.includes('RuntimeWarning') ||
                             message.includes('tracemalloc') ||
                             message.includes('Xet Storage') ||
                             message.includes('ctranslate2') ||
                             message.includes('float16') ||
                             message.includes('float32');
                             
            if (message && !isWarning) {
                // If this is a "command not found" error, try next Python command
                if ((message.includes('not found') || message.includes('not recognized')) && !hasStarted) {
                    this.log('AUDIO', `${cmdDisplay} failed, trying next...`, 'yellow');
                    setTimeout(() => this.tryPythonCommands(commands, index + 1), 500);
                    return;
                }
                // Check for missing dependencies
                if (message.includes('ModuleNotFoundError') || message.includes('No module named')) {
                    this.log('AUDIO', `Missing Python dependencies. Run: pip install -r requirements.txt`, 'red');
                    this.log('AUDIO', `Error: ${message}`, 'red');
                    return;
                }
                this.log('AUDIO', `Error: ${message}`, 'red');
            }
        });
        
        audioProcess.on('close', (code) => {
            if (!hasStarted && !this.isShuttingDown) {
                // Try next Python command if this one failed to start
                this.log('AUDIO', `${cmdDisplay} failed (code ${code}), trying next...`, 'yellow');
                setTimeout(() => this.tryPythonCommands(commands, index + 1), 500);
            } else if (!this.isShuttingDown) {
                this.log('AUDIO', `Process exited with code ${code}`, 'red');
                this.shutdown();
            }
        });
        
        // Send auto-start command to audio service after 3 seconds
        setTimeout(() => {
            if (this.processes.audio && !this.processes.audio.killed && hasStarted) {
                this.log('AUDIO', 'Auto-starting audio recording...', 'yellow');
                this.processes.audio.stdin.write('s\n');
            }
        }, 3000);
    }

    openBrowser() {
        const url = 'http://localhost:3001';
        this.log('BROWSER', `Opening ${url}`, 'magenta');
        
        const openCmd = process.platform === 'win32' ? 'start' : 
                       process.platform === 'darwin' ? 'open' : 'xdg-open';
        
        exec(`${openCmd} ${url}`, (error) => {
            if (error) {
                this.log('BROWSER', `Could not auto-open browser. Please visit: ${url}`, 'yellow');
            }
        });
    }

    showInstructions() {
        console.log('\n' + '='.repeat(60));
        this.log('READY', '🚀 MeetingNexus is running!', 'bright');
        console.log('');
        this.log('READY', '📍 Web Interface: http://localhost:3001', 'cyan');
        this.log('READY', '🎤 Audio service is auto-started', 'green');
        this.log('READY', '📡 WebSocket server is running', 'blue');
        console.log('');
        this.log('USAGE', '1. Click "Start Meeting" in the web interface', 'yellow');
        this.log('USAGE', '2. Start speaking - the graph will build automatically!', 'yellow');
        this.log('USAGE', '3. Type "n" here to switch speakers', 'yellow');
        this.log('USAGE', '4. Press Ctrl+C to stop all services', 'yellow');
        console.log('='.repeat(60) + '\n');
        
        // Set up input handling for speaker switching
        this.setupInputHandling();
    }

    setupInputHandling() {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        
        process.stdin.on('data', (key) => {
            const char = key.toString();
            
            if (char === '\u0003') { // Ctrl+C
                this.shutdown();
            } else if (char.toLowerCase() === 'n') {
                this.log('INPUT', 'Switching to next speaker...', 'yellow');
                if (this.processes.audio && !this.processes.audio.killed) {
                    this.processes.audio.stdin.write('n\n');
                }
            } else if (char.toLowerCase() === 'h') {
                this.showHelp();
            }
        });
    }

    showHelp() {
        console.log('\n' + '-'.repeat(40));
        this.log('HELP', 'Available commands:', 'cyan');
        this.log('HELP', '  n - Switch to next speaker', 'white');
        this.log('HELP', '  h - Show this help', 'white');
        this.log('HELP', '  Ctrl+C - Stop all services', 'white');
        console.log('-'.repeat(40) + '\n');
    }

    setupSignalHandlers() {
        const gracefulShutdown = () => {
            if (!this.isShuttingDown) {
                this.shutdown();
            }
        };
        
        process.on('SIGINT', gracefulShutdown);
        process.on('SIGTERM', gracefulShutdown);
        process.on('SIGQUIT', gracefulShutdown);
    }

    async shutdown() {
        if (this.isShuttingDown) return;
        this.isShuttingDown = true;
        
        console.log('\n' + '='.repeat(60));
        this.log('SHUTDOWN', '🛑 Shutting down MeetingNexus...', 'yellow');
        
        // Stop processes gracefully
        const shutdownPromises = Object.entries(this.processes).map(([name, process]) => {
            return new Promise((resolve) => {
                if (process && !process.killed) {
                    this.log('SHUTDOWN', `Stopping ${name}...`, 'yellow');
                    
                    // Try graceful shutdown first
                    process.kill('SIGTERM');
                    
                    // Force kill after 3 seconds
                    const forceKill = setTimeout(() => {
                        if (!process.killed) {
                            process.kill('SIGKILL');
                        }
                    }, 3000);
                    
                    process.on('close', () => {
                        clearTimeout(forceKill);
                        this.log('SHUTDOWN', `${name} stopped`, 'green');
                        resolve();
                    });
                } else {
                    resolve();
                }
            });
        });
        
        await Promise.all(shutdownPromises);
        
        this.log('SHUTDOWN', '✅ All components stopped', 'green');
        console.log('='.repeat(60));
        process.exit(0);
    }
}

// Start the launcher
new MeetingNexusLauncher();