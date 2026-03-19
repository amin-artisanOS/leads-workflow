import pandas as pd

domains = [
    "abou-labs.com",
    "aboulabs.com",
    "aboulstudio.com",
    "abou-studio.com",
    "catalogmuse.com",
    "catalogmuse.eu",
    "kernmode.com",
    "trycommerium.com",
    "abgrowth-partners.de",
    "meetinnerunionhome.es"
]

name_variations = [
    ("Amin", "Boulabaim Amjahid"),
    ("Amin", "Boulabaim"),
    ("Amin", "Amjahid"),
    ("Amin B.", "Amjahid"),
    ("Amin Boulabaim", "Amjahid"),
    ("Amin B. A.", "Amjahid"),
    ("Amin", "Boulabaim A."),
    ("Amin B.", "Boulabaim"),
    ("Amin", "A. Boulabaim"),
    ("Amin A.", "Amjahid")
]

headers = [
    'Status', 'Organization', 'ESP', 'Domain', 'Email', 'First Name', 'Last Name',
    'Profile Picture (Link)', 'Preferred Password', 'Recovery Email', 'Domain Forwarding',
    'Domain Registrar URL', 'Domain Registrar Username', 'Domain Registrar Password',
    'Sending Tool URL', 'Sending Tool Username', 'Sending Tool Password', 'Workspace (Sending tool)'
]

data = []
row_idx = 0
for domain in domains:
    for _ in range(3):
        first_name, last_name = name_variations[row_idx % len(name_variations)]
        
        # Generate a simple email handle based on the name variation
        handle = first_name.lower().replace(" ", "").replace(".", "")
        if row_idx % 3 == 1:
            handle = f"{first_name[0].lower()}{last_name.lower().split()[0]}"
        elif row_idx % 3 == 2:
            handle = f"{first_name.lower().split()[0]}.{last_name.lower().split()[0]}"
            
        row = {
            'Status': 'New',
            'Organization': 'AB Growth Partner',
            'ESP': 'Google Workspace',
            'Domain': domain,
            'Email': f"{handle}@{domain}",
            'First Name': first_name,
            'Last Name': last_name,
            'Profile Picture (Link)': 'https://images.unsplash.com/photo-1560250097-0b93528c311a', # Placeholder professional pic
            'Preferred Password': 'AminGrowth2026!',
            'Recovery Email': 'amin.boulabaim@gmail.com',
            'Domain Forwarding': f'https://{domain}',
            'Domain Registrar URL': 'https://dash.cloudflare.com',
            'Domain Registrar Username': 'amin.boulabaim@gmail.com',
            'Domain Registrar Password': 'SEE_PRIVATE_NOTES',
            'Sending Tool URL': 'https://app.smartlead.ai',
            'Sending Tool Username': 'amin.boulabaim@gmail.com',
            'Sending Tool Password': 'SEE_PRIVATE_NOTES',
            'Workspace (Sending tool)': 'Primary'
        }
        data.append(row)
        row_idx += 1

df = pd.DataFrame(data)
df.to_csv("/Users/aminb101/leads-workflow/ManualOrder_Filled.csv", index=False)
print("CSV generated at /Users/aminb101/leads-workflow/ManualOrder_Filled.csv")
