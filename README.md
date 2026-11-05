Purpose: A Dictation App That Actually Works 

CORE IDEA: Speech to Text 

Process 

Microphone --> React Frontend --POST ENDPOINT--> FastAPI Backend --> Whisper (speech -> raw text) --> Claude LLM (raw text --> cleaned text) --> React FrontEnd 

Components 
- Frontend 
    - Microphone Button 
        - Turns on speech-to-text capabilities. 
    - Text Box 
        - Showing text converted from speech. 
    - Toggle Button 
        - Show what Whisper heard vs what the LLM got from that. 
- Backend 
    - Two Parts 
        - Speech-to-Text Library 
            - Use Whisper (free)
            - To convert the spech into text. 
        - LLM for Text Cleanup  
            - To clean up the text (remove filler words, clarify sentences, etc.). 


Architecture 
- FrontEnd 
    - src/App.tsx 
        - Records audio from the selected microphone and sends it to the backend. 
        - Shows the returned text, a "Transcribing…" loading state, and any errors. 
- BackEnd 
    - main.py 
        - Creates the FastAPI app and allows requests from the frontend (localhost:5173). 
    - Controller Layer (controller/transcribe_controller.py) 
        - POST /api/transcribe 
        - Receives the audio file and returns { raw_text, cleaned_text, error }. 
    - Service Layer (service/transcribe_service.py) 
        - speech_to_text: Whisper converts the audio into raw text. 
        - clean_up_text: Claude cleans up the raw text. 
        - If the cleanup fails, the Whisper text is still returned with an error message. 
    - .env 
        - WHISPER_MODEL, CLAUDE_MODEL, ANTHROPIC_API_KEY 


Technology 
- Language: 
    - Backend: Python 
    - Frontend: React / TypeScript 
- LLM: Claude 
- Libraries: 
    - Whisper (speech-to-text) 

