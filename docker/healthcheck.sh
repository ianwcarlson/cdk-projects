#!/usr/bin/env bash
# Description : Checks if heartbeat file is newer than some time in the past

set -e

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
DATE_OFFSET="10 min ago"
REF_FILE_NAME="ref-file"

# Create dummy reference file with timestamp in the past
touch -t $(date --date="${DATE_OFFSET}" +"%Y%m%d%H%M.%S") $SCRIPT_DIR/$REF_FILE_NAME

# Check if heartbeat.txt file is newer than reference file
if [ $SCRIPT_DIR/heartbeat.json -nt $SCRIPT_DIR/$REF_FILE_NAME ]; then
  echo "heartbeat file is newer than $DATE_OFFSET"
  rm $SCRIPT_DIR/$REF_FILE_NAME
  exit 0;
else
  echo "heartbeat file is older than $DATE_OFFSET"
  rm $SCRIPT_DIR/$REF_FILE_NAME
  exit 1;
fi