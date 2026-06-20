// Serverless proxy so the Claude API key never reaches the client.
// Configure ANTHROPIC_API_KEY in Netlify's site environment variables (never commit it).
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 503, body: JSON.stringify({ error: "AI coaching is not configured yet." }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body." }) };
  }

  const lifts = Array.isArray(payload.lifts) ? payload.lifts.slice(-60) : [];
  const runs = Array.isArray(payload.runs) ? payload.runs.slice(-30) : [];
  const weights = Array.isArray(payload.weights) ? payload.weights.slice(-14) : [];

  if (!lifts.length && !runs.length) {
    return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ tips: [] }) };
  }

  const prompt = `You are a knowledgeable hybrid-athlete coach (strength training + running). Based on this person's recent logged training data, write 1-3 short, specific, practical coaching tips (max 2 sentences each). Reference real numbers from their data where relevant. Be encouraging but direct, and avoid generic advice that ignores their actual numbers.

Recent lift sets (date, muscle_group, exercise_name, weight_kg, reps):
${JSON.stringify(lifts)}

Recent runs (date, run_type, distance_km, duration_seconds):
${JSON.stringify(runs)}

Recent body weight log (date, weight_kg):
${JSON.stringify(weights)}

Respond with ONLY a JSON array of strings, one per tip. No markdown, no preamble, no explanation.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      return { statusCode: 502, body: JSON.stringify({ error: "AI coach request failed." }) };
    }

    const data = await response.json();
    const rawText = data.content?.[0]?.text || "[]";
    // Models sometimes wrap JSON in a markdown code fence despite instructions not to.
    const text = rawText.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

    let tips;
    try {
      tips = JSON.parse(text);
    } catch {
      tips = [text];
    }
    if (!Array.isArray(tips)) tips = [];

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tips }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: "AI coach request failed." }) };
  }
};
