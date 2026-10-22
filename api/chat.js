// Vercel Serverless Function — PRODUCTION GRADE OPENROUTER PROXY
// Using model: openai/gpt-oss-120b

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { query, contextStats } = req.body;
    // FETCH KEY FROM ENVIRONMENT VARIABLES (SAFE FOR GIT)
    const OR_KEY = process.env.OPENROUTER_API_KEY;

    if (!OR_KEY) {
        return res.status(500).json({ error: 'OpenRouter API Key not configured in Vercel. Go to Settings > Environment Variables.' });
    }

    const systemPrompt = `You are CareSync AI, a 120B parameters medical data expert.
Summary of currently loaded hospital dataset (3,000 records):
- ${contextStats}

Rules:
1. Use the dataset summary provided above for clinical context.
2. Be professional and highly analytical.
3. Format response in clean HTML <p> and <ul>.`;

    try {
        const response = await fetch(`https://openrouter.ai/api/v1/chat/completions`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OR_KEY}`,
                'HTTP-Referer': 'https://caresync-dashboard.vercel.app',
                'X-Title': 'CareSync Hospital Dashboard'
            },
            body: JSON.stringify({
                model: "openai/gpt-oss-120b",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: query }
                ],
                temperature: 0.7,
                max_tokens: 4096
            })
        });

        const data = await response.json();
        
        if (data.choices && data.choices[0].message && data.choices[0].message.content) {
            return res.status(200).json({ text: data.choices[0].message.content });
        } else {
            const rawError = data.error ? (data.error.message || JSON.stringify(data.error)) : 'OpenRouter failed to respond.';
            console.error('OpenRouter Error:', data);
            return res.status(500).json({ error: rawError, details: data });
        }
    } catch (err) {
        console.error('Server Error:', err);
        return res.status(500).json({ error: 'Internal server error while calling OpenRouter.' });
    }
}
