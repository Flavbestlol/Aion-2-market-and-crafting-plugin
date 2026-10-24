#!/bin/sh
# Four frames of a GIF side by side, to look at before shipping it: sheet.sh <name> <t1> <t2> <t3> <t4>
O=$(cd "$(dirname "$0")" && pwd)/out
n=$1; shift; i=0
for t in "$@"; do ffmpeg -y -v error -ss "$t" -i "$O/$n.gif" -frames:v 1 "$O/chk_$i.png"; i=$((i+1)); done
ffmpeg -y -v error -i "$O/chk_0.png" -i "$O/chk_1.png" -i "$O/chk_2.png" -i "$O/chk_3.png" -filter_complex hstack=4 "$O/sheet_$n.png"
ffprobe -v error -show_entries format=duration -of csv=p=0 "$O/$n.gif"
