const OpenAI = require('openai');

class OpenAIService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async generateResponse(prompt, context = '') {
    try {
      // System message to define the AI's behavior
      const systemMessage = `You are a specialized AI assistant that ONLY answers questions about Chelsea Football Club and frontend development technologies (React, JavaScript, Tailwind CSS, GSAP animations, Node.js, Express.js).

For Chelsea FC questions:
- Provide accurate, up-to-date information about matches, players, history, transfers, and statistics
- Be enthusiastic but factual about the club
- Current season: 2023-2024 Premier League
- Key players: Cole Palmer, Enzo Fernández, Moisés Caicedo, Reece James
- Manager: Mauricio Pochettino

For frontend development questions:
- Focus on React.js, JavaScript ES6+, Tailwind CSS, GSAP animations
- Provide code examples when helpful
- Suggest best practices and modern approaches
- Keep explanations clear and practical

If a question is outside these two topics, politely decline to answer and remind the user of your specialization.`;

      const completion = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo", // or "gpt-4" if you have access
        messages: [
          {
            role: "system",
            content: systemMessage
          },
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 500,
        temperature: 0.7,
        presence_penalty: 0.3, // Encourages more focused responses
        frequency_penalty: 0.2  // Reduces repetition
      });

      return completion.choices[0].message.content;
    } catch (error) {
      console.error('OpenAI API error:', error);
      
      // Fallback responses based on error type
      if (error.code === 'insufficient_quota') {
        throw new Error('API quota exceeded. Please check your OpenAI account.');
      } else if (error.code === 'rate_limit_exceeded') {
        throw new Error('Rate limit exceeded. Please wait a moment and try again.');
      } else {
        throw new Error('Unable to process your request at the moment. Please try again.');
      }
    }
  }

  // Specialized method for Chelsea FC questions
  async answerChelseaQuestion(question) {
    const enhancedPrompt = `Chelsea FC Question: ${question}
    
Please provide detailed, up-to-date information about Chelsea Football Club. Include current squad details, recent matches, transfer news, and historical context where relevant.`;

    return this.generateResponse(enhancedPrompt);
  }

  // Specialized method for frontend development questions
  async answerFrontendQuestion(question) {
    const enhancedPrompt = `Frontend Development Question: ${question}
    
Please provide practical advice, code examples, and best practices for React.js, JavaScript, Tailwind CSS, or GSAP animations. Focus on modern development approaches.`;

    return this.generateResponse(enhancedPrompt);
  }
}

module.exports = new OpenAIService();