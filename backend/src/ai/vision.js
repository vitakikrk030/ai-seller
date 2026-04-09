const axios = require('axios');
const config = require('../config');

const VISION_PROMPT = `Ты — эксперт по кроссовкам и обуви. Определи по фото:
1. Бренд (Nike, Adidas, Puma, Jordan, New Balance и т.д.)
2. Модель (Air Force 1, Yeezy 350, Dunk Low и т.д.)
3. Цвет / расцветку
4. Ключевые слова для поиска в каталоге

Верни ТОЛЬКО JSON в формате:
{"brand":"...","model":"...","color":"...","keywords":"бренд модель цвет"}

Если не можешь определить — верни:
{"brand":null,"model":null,"color":null,"keywords":null}

Не пиши ничего кроме JSON.`;

/**
 * Analyze image via OpenRouter vision API.
 * Returns { brand, model, color, keywords } or null if not recognized.
 */
async function analyzeImage(imageUrl) {
  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: config.get('OPENROUTER_MODEL'),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: VISION_PROMPT },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
        max_tokens: 200,
        temperature: 0.1,
      },
      {
        headers: {
          Authorization: `Bearer ${config.get('OPENROUTER_API_KEY')}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const raw = response.data.choices[0]?.message?.content || '';
    return parseVisionResponse(raw);
  } catch (err) {
    console.error('Vision API error:', err.response?.data || err.message);
    return null;
  }
}

/**
 * Parse JSON from vision response. Tolerant to markdown fences.
 */
function parseVisionResponse(raw) {
  try {
    // Strip markdown code fences if present
    let cleaned = raw.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

    const data = JSON.parse(cleaned);

    if (!data.keywords && !data.brand && !data.model) {
      return null;
    }

    return {
      brand: data.brand || null,
      model: data.model || null,
      color: data.color || null,
      keywords: data.keywords || [data.brand, data.model, data.color].filter(Boolean).join(' ') || null,
    };
  } catch {
    // Try to extract any brand/model words from free-text response
    console.warn('Vision response not valid JSON:', raw);
    return null;
  }
}

module.exports = { analyzeImage, parseVisionResponse, VISION_PROMPT };
