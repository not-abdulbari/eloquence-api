import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

// Define the exact domains you want to allow
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://eloquence.in.net',
  'https://www.eloquence.in.net'
];

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback_secret');

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const origin = request.headers.get('origin') ?? '';
  
  // 1. Determine the allowed origin for the response headers
  const isAllowedOrigin = ALLOWED_ORIGINS.includes(origin);
  const responseOrigin = isAllowedOrigin ? origin : ALLOWED_ORIGINS[2];

  // 2. Handle CORS Preflight (OPTIONS)
  if (request.method === 'OPTIONS') {
    const response = new NextResponse(null, { status: 204 });
    response.headers.set('Access-Control-Allow-Origin', responseOrigin);
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return response;
  }

  // 3. Skip Auth for Login and Register routes
  if (pathname === '/api/login' || pathname === '/api/register') {
    const response = NextResponse.next();
    response.headers.set('Access-Control-Allow-Origin', responseOrigin);
    return response;
  }

  // 4. Authenticate Protected Routes
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.split(' ')[1]; // Extract Bearer <token>

  if (!token) {
    return NextResponse.json({ error: 'No token provided' }, { status: 401 });
  }

  try {
    // Verify the JWT
    await jwtVerify(token, SECRET);
    
    const response = NextResponse.next();
    response.headers.set('Access-Control-Allow-Origin', responseOrigin); 
    return response;
  } catch (err) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
  }
}

export const config = {
  matcher: '/api/:path*', 
};