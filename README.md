Purpose: A Dictation App That Actually Works 

CORE IDEA: Speech to Text 

Process 

Microphone --> React Frontend --POST ENDPOINT--> FastAPI Backend --> Whisper (speech -> raw text) --> OpenAI LLM (raw text --> cleaned text) --> React FrontEnd 

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


Technology 
- Language: 
    - Backend: Python 
    - Frontend: React / TypeScript 
- LLM: OpenAI 
- Libraries: 
    - Whisper (speech-to-text) 

