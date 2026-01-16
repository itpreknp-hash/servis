import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { broj, poruka } = await request.json();

    // 1. EKSTREMNO ČIŠĆENJE BROJA
    // Uzimamo samo cifre, brišemo razmake, pluseve i sve ostalo
    const cistBroj = broj.toString().replace(/\D/g, '');

    // 2. LOGOVANJE (Vidi ovo u terminalu VS Code-a)
    console.log(`[WA-SEND] Šaljem na: "${cistBroj}"`);

    // 3. POZIV KA LINUX MAŠINI
    const response = await fetch('http://95.216.138.215:3001/send', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      // Šaljemo TAČAN JSON format kakav curl pravi
      body: JSON.stringify({
        broj: cistBroj,
        poruka: poruka
      })
    });

    const responseText = await response.text();
    let result;
    
    try {
      result = JSON.parse(responseText);
    } catch (e) {
      result = { error: responseText };
    }

    if (!response.ok || (result && result.success === false)) {
      console.error('[WA-ERROR] Linux odgovorio:', result);
      return NextResponse.json(result, { status: response.status });
    }

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('[WA-FATAL]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}