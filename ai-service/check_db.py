import os, psycopg
u = os.environ.get('DATABASE_URL', '')
print('url set:', bool(u), '| host part:', u.split('@')[-1].split('?')[0])
print('cert exists:', os.path.exists('/certs/prod-ca-2021.crt'))
try:
    c = psycopg.connect(u, connect_timeout=8)
    print('CONNECT OK')
    c.close()
except Exception as e:
    print(type(e).__name__, str(e)[:300])