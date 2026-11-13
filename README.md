# June

June is a sophisticated British personal intelligence, perceptive and highly capable, designed to bring long-term memory, real-time visual awareness, and complete system control together into an articulate, mature assistant.

## Core Features

- **Embedded Long-Term Memory:** June possesses genuine long-term memory powered by a local Postgres Lite (PGlite) database to persist personal preferences, project details, and context across all conversations.
- **Real-Time Visual Perception:** Ability to see and analyze your live workstation screen, Visual Studio Code workspace, console logs, and errors.
- **Full Workstation Control:** Directly executes terminal commands, runs build/test scripts, and manages project files on your local Linux filesystem.
- **VS Code Enhancement:** June can directly open, read, edit project files, view diffs, and manage extensions within Visual Studio Code.
- **Autonomous Agent Orchestration:** Can generate and deploy Autonomous Sub-Agents (e.g., code auditor, researcher, system analyst) to handle specialized tasks in the background.

## Tech Stack

- **Framework:** React, TypeScript, Vite
- **Memory Database:** @electric-sql/pglite
- **AI Integration:** Google GenAI (Gemini)
- **3D Rendering:** Three.js

## Getting Started

1. **Install Dependencies:**
   ```bash
   npm install
   ```
2. **Start Development Server:**
   ```bash
   npm run dev
   ```

## How to Use

Simply communicate with June as you would with a highly capable technical assistant. Here are some examples of what June can do for you:

### 1. Persistent Memory
> "Remember that all my Python projects should use the Black formatter."
> "What are the core requirements for the Project Jarvis we discussed?"

### 2. Live Coding Assistance
> "Take a look at this component code on my screen and fix the state management error."
> "Run the test suite and tell me why it is failing."

### 3. System & File Management
> "Commit these changes and push to my 'June' repository."
> "Open the file `src/services/db.ts` at line 42 in VS Code."

### 4. Specialised Agents
> "June, commission a sub-agent named 'Sentinel' to audit this project database for security vulnerabilities."
