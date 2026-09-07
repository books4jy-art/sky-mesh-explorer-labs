// Drive folder/file IDs. Defaults match the original curated library; override
// via env if you're pointing this at your own copy of the Drive folders.
export const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID || '1Q_MVRbrgS7SqpXCEf0UIGIGV0GyUtUYX';
export const OUTFIT_ICON_FOLDER_ID = process.env.OUTFIT_ICON_FOLDER_ID || '1zphd4EeUovcVKQ7BfY4yqMu8NcUU3LN9';
export const OUTFIT_MESH_FOLDER_ID = process.env.OUTFIT_MESH_FOLDER_ID || '1svaARuxnWMBTYhnx3GhRjNaNEfzZ6kOE';
// Alternate outfit mesh source for Avatar Maker (raw .mesh files, flat
// folder, decoded client-side — see src/lib/skyMeshParser.js). "0.34.5body",
// a subfolder of the main library (DRIVE_FOLDER_ID above).
export const OUTFIT_MESH_FOLDER_ID_ALT = process.env.OUTFIT_MESH_FOLDER_ID_ALT || '15cQ0tNxAimj7ZyFdP-LIb27YmfpGSUNy';
export const PLACEHOLDER_DRIVE_FILE_ID = process.env.PLACEHOLDER_DRIVE_FILE_ID || '1Or3YuWpZjH4WOqVLgp812Q0hRmzSonUP';
export const TEXTURE_LIBRARY_FOLDER_ID = process.env.TEXTURE_LIBRARY_FOLDER_ID || '16EkHXwn3moKx6lGmriRwn5gxzgscZZt5';
