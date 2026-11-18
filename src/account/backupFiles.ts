// Legacy raw archives are retained as files, not interpreted as timestamped v5 snapshots.
export function snapshotBackupIds(files:{id:string}[]){
  return files.filter(file=>/^\d+$/.test(file.id)&&Number.isSafeInteger(Number(file.id))).map(file=>Number(file.id));
}
