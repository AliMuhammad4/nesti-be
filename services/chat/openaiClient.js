import OpenAI from 'openai';

// Lazy OpenAI client so dotenv is loaded first
let _openaiClient = null;

export const getOpenAI = () => {
  if (!_openaiClient) {
    _openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openaiClient;
};

