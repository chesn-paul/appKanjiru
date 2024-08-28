import dotenv from 'dotenv'
dotenv.config()
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_PROJECT
const supabaseKey = process.env.SUPABASE_KEY

const supabase = createClient(supabaseUrl, supabaseKey)

async function createMedia(mediaId, name, type, time, userId, link) {
    const { error } = await supabase
    .from('medias')
    .insert({mediaId: mediaId, name: name, type: type, status: 'active', time: time, userId: userId, link: link});
    throw { error }
}

async function getType(key) {
    const { data, error } = await supabase
    .from('medias')
    .select('type')
    .eq('mediaId', key)
    .single();

    if (error) {
        throw error;
    }
  
    if (data) {
        return data['type'];
    }
}

export {createMedia, getType}