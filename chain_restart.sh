TOTAL=0

pm2 restart oracle_avax &
TOTAL=$((TOTAL+350))

sleep $TOTAL && pm2 restart oracle_fantom &
TOTAL=$((TOTAL+320))

sleep $TOTAL && pm2 restart oracle_bsc &
TOTAL=$((TOTAL+270))

sleep $TOTAL && pm2 restart oracle_eth &
TOTAL=$((TOTAL+450))

sleep $TOTAL && pm2 restart oracle_polygon &
TOTAL=$((TOTAL+550))

sleep $TOTAL && pm2 restart oracle_moonriver &
TOTAL=$((TOTAL+470))

sleep $TOTAL && pm2 restart oracle_cronos &
TOTAL=$((TOTAL+2400))

sleep $TOTAL && pm2 restart oracle_harmony &
TOTAL=$((TOTAL+280))

sleep $TOTAL && pm2 restart oracle_heco &
TOTAL=$((TOTAL+530))

sleep $TOTAL && pm2 restart oracle_celo &
TOTAL=$((TOTAL+100))

sleep $TOTAL && pm2 restart oracle_fuse &

TOTAL=$((TOTAL+660))