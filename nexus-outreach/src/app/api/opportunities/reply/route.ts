
import { NextResponse } from 'next/server';
import axios from 'axios';

const INSTANTLY_API_KEY = process.env.INSTANTLY_API_KEY;

export async function POST(request: Request) {
  if (!INSTANTLY_API_KEY) {
    return NextResponse.json({ error: 'INSTANTLY_API_KEY not found' }, { status: 500 });
  }

  try {
    const { threadId, replyToUuid, body } = await request.json();

    if (!replyToUuid || !body) {
      return NextResponse.json({ error: 'replyToUuid and body are required' }, { status: 400 });
    }

    const api = axios.create({
      baseURL: 'https://api.instantly.ai/api/v2',
      headers: {
        'Authorization': `Bearer ${INSTANTLY_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    // In Instantly API v2, replying usually requires the UUID of the message you're replying to
    const replyRes = await api.post('/emails/reply', {
      reply_to_uuid: replyToUuid,
      body: body
    });

    return NextResponse.json({ success: true, data: replyRes.data });
  } catch (error: any) {
    console.error('Error sending reply:', error.response?.data || error.message);
    return NextResponse.json({ 
      error: 'Failed to send reply', 
      details: error.response?.data || error.message 
    }, { status: 500 });
  }
}
