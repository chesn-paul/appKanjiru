import dotenv from "dotenv";
dotenv.config();
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_PROJECT;
const supabaseKey = process.env.SUPABASE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function createMedia(mediaId, name, type, time, userId, link) {
  const { error } = await supabase.from("medias").insert({
    mediaId: mediaId,
    name: name,
    type: type,
    status: "active",
    time: time,
    userId: userId,
    link: link,
  });
  if (error) {
    throw error;
  }
}

async function getType(key) {
  const { data, error } = await supabase
    .from("medias")
    .select("type,name")
    .eq("mediaId", key)
    .single();

  if (error) {
    throw error;
  }

  if (data) {
    return data;
  }
}

export { createMedia, getType };
