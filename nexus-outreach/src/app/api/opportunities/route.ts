
import { NextResponse } from 'next/server';
import axios from 'axios';

const INSTANTLY_API_KEY = process.env.INSTANTLY_API_KEY;

export async function GET() {
  if (!INSTANTLY_API_KEY) {
    return NextResponse.json({ error: 'INSTANTLY_API_KEY not found' }, { status: 500 });
  }

  try {
    const api = axios.create({
      baseURL: 'https://api.instantly.ai/api/v2',
      headers: {
        'Authorization': `Bearer ${INSTANTLY_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    // Fetch inbound emails from Unibox
    const emailsRes = await api.get('/emails', {
      params: {
        limit: 50
      }
    });
    
    const emails = Array.isArray(emailsRes.data) ? emailsRes.data : (emailsRes.data.items || []);
    
    // Filter for actual inbound replies (not automated or outbound)
    // We'll consider any email that is inbound and not from our own domains
    const ourEmails = [
      'amin-boul@abgrowth-partners.de', 
      'amin-b@ab-growthpartners.com', 
      'amin-bou@ab-growthpartners.com',
      'amin-bou@abgrowth-partners.de'
    ];
    
    const inbound = emails.filter((e: any) => !ourEmails.includes(e.from_address_email));
    
    // Map to a cleaner format for the UI
    const opportunities = inbound.map((e: any) => ({
      id: e.id,
      from: e.from_address_email,
      name: e.lead_name || e.from_address_email.split('@')[0],
      subject: e.subject,
      snippet: e.body_text || e.body?.html?.replace(/<[^>]*>/g, '').substring(0, 200) || '',
      timestamp: e.timestamp_email,
      campaignId: e.campaign_id,
      isOpportunity: true // We can add more logic here later
    }));

    return NextResponse.json(opportunities);
  } catch (error) {
    console.error('Error fetching opportunities:', error);
    return NextResponse.json({ error: 'Failed to fetch opportunities' }, { status: 500 });
  }
}
