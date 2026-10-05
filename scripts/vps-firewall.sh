#!/usr/bin/env bash
# Docker-published ports bypass UFW: filter new WAN traffic in DOCKER-USER too.
set -Eeuo pipefail
[[ "$EUID" == 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
mode="${1:-private}"
[[ "$mode" == private || "$mode" == https ]] || { echo 'Use private or https.' >&2; exit 2; }
wan="$(ip -4 route show default | awk '{for (i=1;i<=NF;i++) if ($i == "dev") {print $(i+1); exit}}')"
[[ -n "$wan" ]] || { echo 'Default WAN interface was not found.' >&2; exit 1; }
ufw allow 22/tcp comment 'KODMOD SSH'
if [[ "$mode" == https ]]; then
  ufw allow 80/tcp comment 'KODMOD HTTPS certificates'
  ufw allow 443/tcp comment 'KODMOD HTTPS'
fi
# Persist the configured UFW policy across host reboots as well as Docker restarts.
systemctl is-enabled --quiet ufw.service || systemctl enable ufw.service
for command in iptables ip6tables; do
  # IPv6 Docker chains do not exist when Docker IPv6 is disabled; UFW still
  # filters host IPv6 listeners. Never change the INPUT/SSH path here.
  "$command" -w -nL DOCKER-USER >/dev/null 2>&1 || continue
  "$command" -w -nL KODMOD-INGRESS >/dev/null 2>&1 || "$command" -w -N KODMOD-INGRESS
  "$command" -w -F KODMOD-INGRESS
  "$command" -w -A KODMOD-INGRESS -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
  if [[ "$mode" == https ]]; then
    for port in 80 443; do
      "$command" -w -A KODMOD-INGRESS -i "$wan" -p tcp -m conntrack --ctorigdstport "$port" -j RETURN
    done
  fi
  "$command" -w -A KODMOD-INGRESS -i "$wan" -j DROP
  "$command" -w -A KODMOD-INGRESS -j RETURN
  "$command" -w -C DOCKER-USER -j KODMOD-INGRESS >/dev/null 2>&1 || "$command" -w -I DOCKER-USER 1 -j KODMOD-INGRESS
done
echo "Applied Docker WAN ingress policy: $mode ($wan)"
