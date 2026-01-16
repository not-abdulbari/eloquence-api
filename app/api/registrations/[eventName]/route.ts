import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseClient'; 

// 1. Origins stay here for the local response headers
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://eloquence.in.net'
];

function getCorsHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[2];

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export async function GET(
  request: Request, 
  { params }: { params: Promise<{ eventName: string }> } //
) {
  const corsHeaders = getCorsHeaders(request);

  try {
    // 2. Next.js 15: Must await dynamic params
    const { eventName } = await params;

    // 3. Database Call (Security is already handled by Middleware)
    const { data, error } = await supabase.rpc('get_event_registrations1', {
      event_name_input: eventName
    });

    if (error) {
      console.error('Supabase Error:', error);
      return NextResponse.json({ error: error.message }, { status: 400, headers: corsHeaders });
    }

    return NextResponse.json(data, { status: 200, headers: corsHeaders });

  } catch (error: any) {
    console.error('Server Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500, headers: corsHeaders });
  }
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(request),
  });
}