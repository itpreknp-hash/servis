import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { broj, poruka } = await request.json();

    const response = await fetch('http://95.216.138.215:3001/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ broj, poruka })
    });

    if (!response.ok) throw new Error('WA server error');

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
  }
}
