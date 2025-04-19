import React, { useState, useEffect, useRef } from 'react';
import { setCookie, getCookie } from './utils.js';

const TextToSpeech = () => {
  const [text, setText] = useState('');
  // Removed rate, pitch, and volume state variables
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isTextareaFocused, setIsTextareaFocused] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('piper');
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [nabuCasaServer, setNabuCasaServer] = useState('');
  const [nabuCasaBearer, setNabuCasaBearer] = useState('');
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  // Initialize speech synthesis and get available voices
  useEffect(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      const loadVoices = () => {
        const availableVoices = window.speechSynthesis.getVoices();
        if (availableVoices.length > 0) {
          setVoices(availableVoices);
          setSelectedVoice(availableVoices[0].name);
        }
      };

      loadVoices();
      window.speechSynthesis.onvoiceschanged = loadVoices;

      return () => {
        window.speechSynthesis.cancel();
      };
    }
  }, []);

  const handleTextChange = (e) => {
    setText(e.target.value);
  };

  const handleTextareaFocus = () => {
    setIsTextareaFocused(true);
  };

  const handleTextareaBlur = () => {
    setIsTextareaFocused(false);
  };

  const handleVoiceChange = (e) => {
    setSelectedVoice(e.target.value);
  };

  const handleRateChange = (e) => {
    setRate(parseFloat(e.target.value));
  };

  const handlePitchChange = (e) => {
    setPitch(parseFloat(e.target.value));
  };

  const handleVolumeChange = (e) => {
    setVolume(parseFloat(e.target.value));
  };

  const handlePasteFromClipboard = async () => {
    try {
      const clipboardText = await navigator.clipboard.readText();
      setText(clipboardText);
    } catch (err) {
      console.error('Failed to read clipboard contents: ', err);
      alert('Unable to access clipboard. Please check your browser permissions.');
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file && file.type === 'text/plain') {
      const reader = new FileReader();
      reader.onload = (event) => {
        setText(event.target.result);
      };
      reader.readAsText(file);
    } else if (file) {
      alert('Please upload a valid text file (.txt)');
    }
  };

  const triggerFileUpload = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const focusTextarea = () => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const speak = () => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();

      if (text) {
        const utterance = new SpeechSynthesisUtterance(text);
        
        const voice = voices.find(v => v.name === selectedVoice);
        if (voice) {
          utterance.voice = voice;
        }
        
        utterance.rate = rate;
        utterance.pitch = pitch;
        utterance.volume = volume;
        
        utterance.onstart = () => {
          setIsSpeaking(true);
          setIsPaused(false);
        };
        
        utterance.onend = () => {
          setIsSpeaking(false);
          setIsPaused(false);
        };
        
        window.speechSynthesis.speak(utterance);
      }
    }
  };

  const pause = () => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.pause();
      setIsPaused(true);
    }
  };

  const resume = () => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.resume();
      setIsPaused(false);
    }
  };

  const stop = () => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      setIsPaused(false);
    }
  };

  const toggleSettings = () => {
    setIsSettingsOpen(!isSettingsOpen);
  };
  
  const handleTabChange = (tab) => {
    setActiveTab(tab);
  };

  const shouldShowButtons = !isTextareaFocused && text.length === 0;

  // Removed slider thumb style classes

  const handleOpenaiApiKeyChange = (e) => {
    const value = e.target.value;
    setOpenaiApiKey(value);
    setCookie('openai_api_key', value);
  };

  const handleNabuCasaServerChange = (e) => {
    const value = e.target.value;
    setNabuCasaServer(value);
    setCookie('nabu_casa_server', value);
  };

  const handleNabuCasaBearerChange = (e) => {
    const value = e.target.value;
    setNabuCasaBearer(value);
    setCookie('nabu_casa_bearer', value);
  };

  // Load saved credentials on component mount
  useEffect(() => {
    const savedOpenaiKey = getCookie('openai_api_key');
    const savedNabuServer = getCookie('nabu_casa_server');
    const savedNabuBearer = getCookie('nabu_casa_bearer');
    
    if (savedOpenaiKey) setOpenaiApiKey(savedOpenaiKey);
    if (savedNabuServer) setNabuCasaServer(savedNabuServer);
    if (savedNabuBearer) setNabuCasaBearer(savedNabuBearer);
  }, []);

  return (
    <div className="max-w-screen-lg mx-auto p-4 font-sans">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 text-transparent bg-clip-text">Text to Speech</h1>
        <p className="text-gray-500 mt-2">Convert your text to natural-sounding speech</p>
      </div>
      
      <div className="max-w-xl mx-auto rounded-xl overflow-hidden shadow-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
        {/* Main container */}
        <div className="relative">
          {/* Empty state with buttons */}
          {shouldShowButtons ? (
            <div 
              className="absolute inset-0 flex flex-col items-center justify-center gap-6 p-6 bg-gray-50 dark:bg-gray-800 z-10"
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  focusTextarea();
                }
              }}
            >
              <div className="text-center mb-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto text-blue-500 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
                <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200">Start with Text</h2>
                <p className="text-gray-500 dark:text-gray-400 mt-1">Choose one of the options below to begin</p>
              </div>
              
              <div className="flex flex-col sm:flex-row gap-4 w-full max-w-xs">
                <button
                  onClick={handlePasteFromClipboard}
                  className="flex-1 py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg flex items-center justify-center gap-2 transition-colors shadow-md hover:shadow-lg"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                    <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
                  </svg>
                  Paste
                </button>
                
                <button
                  onClick={triggerFileUpload}
                  className="flex-1 py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg flex items-center justify-center gap-2 transition-colors shadow-md hover:shadow-lg"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                  </svg>
                  Upload
                </button>
                
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept=".txt"
                  className="hidden"
                />
              </div>
              
              <div className="text-sm text-gray-500 dark:text-gray-400">
                or click anywhere to type
              </div>
            </div>
          ) : null}
          
          {/* Textarea */}
          <textarea
            ref={textareaRef}
            className="w-full p-6 text-gray-700 dark:text-gray-200 focus:outline-none dark:bg-gray-800 h-64 resize-none"
            placeholder="Type or paste your text here..."
            value={text}
            onChange={handleTextChange}
            onFocus={handleTextareaFocus}
            onBlur={handleTextareaBlur}
          />
        </div>
        
        {/* Controls */}
        <div className="border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center p-4">
            {/* Main controls */}
            <div className="flex-1 flex gap-3">
              <button
                className={`flex items-center justify-center px-4 py-2 rounded-lg font-medium ${isSpeaking && !isPaused ? 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400 cursor-default' : 'bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-lg transition-all'}`}
                onClick={speak}
                disabled={isSpeaking && !isPaused}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                </svg>
                {isSpeaking && !isPaused ? 'Speaking...' : 'Speak'}
              </button>
              
              {isSpeaking && (
                <>
                  {!isPaused ? (
                    <button
                      className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white font-medium rounded-lg flex items-center justify-center gap-2 shadow-md hover:shadow-lg transition-all"
                      onClick={pause}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      Pause
                    </button>
                  ) : (
                    <button
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg flex items-center justify-center gap-2 shadow-md hover:shadow-lg transition-all"
                      onClick={resume}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                      </svg>
                      Resume
                    </button>
                  )}
                  
                  <button
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg flex items-center justify-center gap-2 shadow-md hover:shadow-lg transition-all"
                    onClick={stop}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
                    </svg>
                    Stop
                  </button>
                </>
              )}
            </div>
            
            {/* Settings toggle */}
            <button 
              className={`p-2 rounded-lg ${isSettingsOpen ? 'bg-gray-200 dark:bg-gray-700' : 'hover:bg-gray-100 dark:hover:bg-gray-700'} transition-colors`}
              onClick={toggleSettings}
              aria-label="Toggle Settings"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-600 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
          
          {/* Settings panel */}
          <div className={`border-t border-gray-200 dark:border-gray-700 transition-all duration-300 ease-in-out overflow-hidden ${isSettingsOpen ? 'max-h-screen' : 'max-h-0'}`}>
            <div className="p-4 space-y-6">
              {/* TTS Engine Tabs */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  TTS Engine
                </label>
                <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-1 mb-4">
                  <button 
                    className={`flex-1 py-2 px-3 rounded-lg font-medium text-sm transition-colors ${activeTab === 'piper' ? 'bg-blue-600 text-white' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
                    onClick={() => handleTabChange('piper')}
                  >
                    Piper Local {activeTab === 'piper' && <span className="ml-1 px-1.5 py-0.5 text-xs bg-green-500 rounded-full">RECOMMENDED</span>}
                  </button>
                  <button 
                    className={`flex-1 py-2 px-3 rounded-lg font-medium text-sm transition-colors ${activeTab === 'openai' ? 'bg-blue-600 text-white' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
                    onClick={() => handleTabChange('openai')}
                  >
                    OpenAI
                  </button>
                  <button 
                    className={`flex-1 py-2 px-3 rounded-lg font-medium text-sm transition-colors ${activeTab === 'nabu-casa' ? 'bg-blue-600 text-white' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
                    onClick={() => handleTabChange('nabu-casa')}
                  >
                    Nabu Casa
                  </button>
                </div>
                
                {/* Piper Local Tab Content */}
                <div className={`space-y-4 ${activeTab === 'piper' ? '' : 'hidden'}`}>
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    <p className="mb-2">
                      Thank you, <a href="https://wide.video" target="_blank" className="text-blue-600 dark:text-blue-400 hover:underline">Wide Video</a>, for the Web Assembly Piper TTS! (<a href="https://piper.wide.video/" target="_blank" className="text-blue-600 dark:text-blue-400 hover:underline">https://piper.wide.video/</a>)
                    </p>
                    <p className="mb-2">
                      Some voices may cause errors. If a voice is causing you trouble, please submit an issue on <a href="https://github.com/myrakrusemark/text2speech.org" target="_blank" className="text-blue-600 dark:text-blue-400 hover:underline">GitHub</a>.
                    </p>
                    <p className="mb-2">
                      8GB RAM required. 16GB RAM recommended.
                    </p>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2" htmlFor="piper-voice-select">
                      Select Voice:
                    </label>
                    <select
                      id="piper-voice-select"
                      className="w-full px-3 py-2 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option>Please wait...</option>
                    </select>
                  </div>
                </div>
                
                {/* OpenAI Tab Content */}
                <div className={`space-y-4 ${activeTab === 'openai' ? '' : 'hidden'}`}>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2" htmlFor="openai-api-key">
                      OpenAI API Key
                    </label>
                    <input
                      type="text"
                      id="openai-api-key"
                      placeholder="Enter your API key"
                      className="w-full px-3 py-2 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={openaiApiKey}
                      onChange={handleOpenaiApiKeyChange}
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2" htmlFor="openai-voice-select">
                      Voice
                    </label>
                    <div className="flex items-center">
                      <select
                        id="openai-voice-select"
                        className="flex-1 px-3 py-2 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="nova">Nova</option>
                        <option value="alloy">Alloy</option>
                        <option value="echo">Echo</option>
                        <option value="fable">Fable</option>
                        <option value="onyx">Onyx</option>
                        <option value="shimmer">Shimmer</option>
                      </select>
                      <div className="ml-3 flex items-center">
                        <input
                          type="checkbox"
                          id="hd-audio"
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <label htmlFor="hd-audio" className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                          HD
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Nabu Casa Tab Content */}
                <div className={`space-y-4 ${activeTab === 'nabu-casa' ? '' : 'hidden'}`}>
                  <div className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                    <p>
                      If running locally (HTTP), you can set "Server Address" to your local LAN address (HTTP). On https://text2speech.org, you must use your nabu casa hosted address, or other HTTPS address.
                    </p>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2" htmlFor="nabu-casa-server">
                      Server Address
                    </label>
                    <input
                      type="text"
                      id="nabu-casa-server"
                      placeholder="Enter Nabu Casa server address"
                      className="w-full px-3 py-2 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={nabuCasaServer}
                      onChange={handleNabuCasaServerChange}
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2" htmlFor="nabu-casa-bearer">
                      Bearer Token
                    </label>
                    <input
                      type="text"
                      id="nabu-casa-bearer"
                      placeholder="Enter bearer token"
                      className="w-full px-3 py-2 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={nabuCasaBearer}
                      onChange={handleNabuCasaBearerChange}
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2" htmlFor="nabu-casa-voice-select">
                      Voice
                    </label>
                    <select
                      id="nabu-casa-voice-select"
                      className="w-full px-3 py-2 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option>Please wait...</option>
                    </select>
                  </div>
                </div>
              </div>
              
              {/* Original Browser Voice Settings */}
              <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">Browser Speech Settings</h3>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2" htmlFor="voice-select">
                    Voice
                  </label>
                  <select
                    id="voice-select"
                    className="w-full px-3 py-2 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={selectedVoice}
                    onChange={handleVoiceChange}
                  >
                    {voices.map((voice) => (
                      <option key={voice.name} value={voice.name}>
                        {voice.name} ({voice.lang})
                      </option>
                    ))}
                  </select>
                </div>
                

              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
export default TextToSpeech;
