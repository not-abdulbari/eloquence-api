// app/api/register/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseClient';
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";


⌄
⌄
⌄
⌄
// --- START: CORS Helper Functions ---
// These functions handle CORS preflight requests and add necessary headers

// Define your allowed origins here
const ALLOWED_ORIGINS = [
    "https://admin.eloquence.in.net"
  "https://eloquence.in.net", // Your main domain
  "https://eloquence.pages.dev", // Your Cloudflare Pages domain
  "http://localhost:3000" // Your local development server
];

function handleOptions(request) {
  const origin = request.headers.get("Origin");
  // Check if the Origin header is present and is in the allowed list
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": origin, // Use the specific origin from the request
        "Access-Control-Allow-Methods": "POST, GET, PUT, DELETE OPTIONS", // List allowed methods
        "Access-Control-Allow-Headers": "Content-Type", // List allowed headers
        "Access-Control-Max-Age": "86400", // Cache preflight for 24 hours
      },
    });
  } else {
    // If origin is not allowed, return a 403 or just the basic headers without origin
    // Returning a response without the header or a 403 is more secure than a blanket allow
    return new Response(null, {
      status: 403, // Forbidden
      headers: {
         // Do NOT include "Access-Control-Allow-Origin" header here
         "Access-Control-Allow-Methods": "POST, GET, PUT, DELETE, OPTIONS",
         "Access-Control-Allow-Headers": "Content-Type",
         "Access-Control-Max-Age": "86400",
      },
    });
  }
}

function addCorsHeaders(response, request) { // Pass the request object here too
  const origin = request.headers.get("Origin");
  // Check if the Origin header is present and is in the allowed list
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin); // Use the specific origin from the request
  }
  // Note: Access-Control-Allow-Credentials is often needed with specific origins
  // but requires the origin to be specified explicitly (not '*').
  // response.headers.set("Access-Control-Allow-Credentials", "true"); // Uncomment if needed
  response.headers.set("Access-Control-Max-Age", "86400");
  return response;
}
// --- END: CORS Helper Functions ---

// --- Environment Variable Validation ---
// Ensure all necessary environment variables are set. The build will fail if any are missing.
if (
  !process.env.CF_ACCOUNT_ID ||
  !process.env.CF_ACCESS_KEY_ID ||
  !process.env.CF_SECRET_ACCESS_KEY ||
  !process.env.R2_BUCKET_NAME
) {
  throw new Error("Missing Cloudflare R2 environment variables. Please check your deployment settings.");
}

// --- S3 Client Initialization for Cloudflare R2 ---
const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CF_ACCESS_KEY_ID,
    secretAccessKey: process.env.CF_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME;

/**
 * Uploads a file buffer to Cloudflare R2 and returns its public URL.
 * @param fileBuffer The file content as a Buffer.
 * @param fileName The unique name for the file in the bucket.
 * @param contentType The MIME type of the file.
 * @returns The publicly accessible URL of the uploaded file.
 */
async function uploadFileToR2(fileBuffer: Buffer, fileName: string, contentType: string): Promise<string> {
  const key = `registration-screenshots/${fileName}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: fileBuffer,
    ContentType: contentType,
  });

  await r2Client.send(command);

  // This URL assumes you have a custom domain/CDN set up to serve your R2 bucket.
  // Example: 'cdn.eloquence.in.net' should be publicly serving files from your R2 bucket.
  return `https://cdn.eloquence.in.net/${key}`;
}


// --- Main API Handler for POST Requests ---
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    // --- Extract and Parse Form Data ---
    const mainRegistrantData = JSON.parse(formData.get('mainRegistrantData') as string);
    const eventRegistrationsData = JSON.parse(formData.get('eventRegistrationsData') as string);
    const totalAmount = parseFloat(formData.get('totalAmount') as string);
    const submittedAt = formData.get('submittedAt') as string;
    const paymentScreenshotFile = formData.get('paymentScreenshot') as File | null;

    // --- File Validation ---
    if (!paymentScreenshotFile) {
      return NextResponse.json({ error: "Payment screenshot is required." }, { status: 400 });
    }
    if (!paymentScreenshotFile.type.startsWith('image/')) {
      return NextResponse.json({ error: "Invalid file type. Please upload an image." }, { status: 400 });
    }

    // --- File Processing and Upload ---
    const bytes = await paymentScreenshotFile.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const fileExtension = paymentScreenshotFile.name.split('.').pop()?.toLowerCase() || 'jpg';
    const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 15)}.${fileExtension}`;
    const r2Url = await uploadFileToR2(buffer, fileName, paymentScreenshotFile.type);

    // --- Database Transactions ---

    // 1. Insert the main registration record
    const { data: registrationData, error: registrationError } = await supabase
      .from('registrations')
      .insert([{
        main_registrant_title: mainRegistrantData.title,
        main_registrant_name: mainRegistrantData.name,
        main_registrant_email: mainRegistrantData.email,
        main_registrant_phone: mainRegistrantData.phone,
        main_registrant_roll_no: mainRegistrantData.rollNo,
        main_registrant_college_name: mainRegistrantData.collegeName,
        main_registrant_year: mainRegistrantData.year,
        main_registrant_degree: mainRegistrantData.degree,
        main_registrant_department: mainRegistrantData.department,
        total_amount: totalAmount,
        payment_screenshot_url: r2Url,
        submitted_at: submittedAt,
      }])
      .select('id') // Only select the ID we need
      .single();

    if (registrationError) {
      console.error('Supabase registration insertion error:', registrationError);
      return NextResponse.json({ error: "Failed to save main registration data.", details: registrationError.message }, { status: 500 });
    }

    // 2. Loop through each event and its team members
    for (const reg of eventRegistrationsData) {
      // Find the event's UUID based on its title (e.g., 'coding-debugging')
      const { data: eventData, error: eventError } = await supabase
        .from('events')
        .select('id')
        .eq('title', reg.eventId)
        .single();

      if (eventError || !eventData) {
        console.error(`Could not find event with title: ${reg.eventId}`, eventError);
        return NextResponse.json({ error: `Event '${reg.eventId}' not found.` }, { status: 404 });
      }
      const eventUUID = eventData.id;

      // Insert into 'event_registrations' with the correct foreign keys
      const { data: eventRegData, error: eventRegError } = await supabase
        .from('event_registrations')
        .insert([{
          registration_id: registrationData.id,
          event_id: eventUUID,
          team_size: reg.teamSize,
        }])
        .select('id') // Select the ID for the next step
        .single();
      
      if (eventRegError) {
        console.error('Supabase event registration error:', eventRegError);
        return NextResponse.json({ error: "Failed to save event registration data.", details: eventRegError.message }, { status: 500 });
      }

      // 3. Insert team members for the current event registration
      const teamMembersToInsert = reg.teamMembers.map((member: any) => ({
        event_registration_id: eventRegData.id,
        title: member.title,
        name: member.name,
        email: member.email,
        phone: member.phone,
        roll_no: member.rollNo,
        college_name: member.collegeName || mainRegistrantData.collegeName,
        year: member.year,
        degree: member.degree,
        department: member.department || mainRegistrantData.department,
        is_team_lead: member.isTeamLead,
        is_alternate_contact: member.isAlternateContact,
      }));
      
      const { error: teamMemberError } = await supabase
        .from('team_members')
        .insert(teamMembersToInsert);

      if (teamMemberError) {
        console.error('Supabase team member error:', teamMemberError);
        return NextResponse.json({ error: "Failed to save team member data.", details: teamMemberError.message }, { status: 500 });
      }
    }

    // --- Success Response ---
    return NextResponse.json({
      message: "Registration submitted successfully!",
      registrationId: registrationData.id,
    });

  } catch (error) {
    console.error('Unexpected error in POST /api/register:', error);
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
    return NextResponse.json({ error: "An unexpected server error occurred.", details: errorMessage }, { status: 500 });
  }
}
