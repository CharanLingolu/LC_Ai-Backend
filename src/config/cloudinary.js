// src/config/cloudinary.js
import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";

// Make sure .env is loaded here as well
dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Optional: small sanity log (do NOT log key/secret)
if (!process.env.CLOUDINARY_API_KEY) {
  console.warn("⚠️ CLOUDINARY_API_KEY is missing. Check your backend .env");
}

export default cloudinary;
