export const DRIVE_FOLDER_ID = '1Q_MVRbrgS7SqpXCEf0UIGIGV0GyUtUYX';

export async function driveAuth(base44) {
  const { accessToken } = await base44.asServiceRole.connectors.getConnection('googledrive');
  return { Authorization: `Bearer ${accessToken}` };
}
