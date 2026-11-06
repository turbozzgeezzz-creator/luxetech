# Plug on the packing slip

Customers don't choose a plug. Mains-powered products (tagged `mains-plug`: hair dryer, hot air styler, vacuum,
espresso machine, ice cream maker, projector, 35W charger) ship with the plug for the **delivery country**. The
website shows the same plug on the product page (`snippets/plug-type.liquid`), and eBay orders from Marketplace
Connect are normal Shopify orders, so they get the same slip.

## Add it (once, 2 minutes)

1. Shopify admin > **Settings > Shipping and delivery > Packing slips > Edit**.
2. Paste the block below at the very top of the template (above everything else). Save.
3. Print a test: open any order > **Print packing slip**. The plug box sits at the top.

```liquid
{%- liquid
  assign c = shipping_address.country_code | default: billing_address.country_code | upcase
  assign key = ',' | append: c | append: ','
  assign au = ',AU,NZ,FJ,PG,TO,WS,VU,SB,AR,UY,CN,'
  assign uk = ',GB,IE,HK,SG,MY,AE,SA,QA,KW,BH,OM,CY,MT,MU,KE,NG,GH,ZW,ZM,UG,TZ,JE,GG,IM,GI,MO,BN,LK,'
  assign us = ',US,CA,MX,JP,TW,PH,TH,CO,EC,PE,VE,PR,GT,CR,PA,DO,HN,SV,NI,JM,BS,BM,KY,BR,'
  assign plug = 'EU'
  if au contains key
    assign plug = 'AU'
  elsif uk contains key
    assign plug = 'UK'
  elsif us contains key
    assign plug = 'US'
  endif
-%}
<div style="border:4px solid #000;border-radius:8px;padding:12px 16px;margin:0 0 16px;text-align:center;font-family:Arial,sans-serif;">
  <div style="font-size:14px;font-weight:bold;letter-spacing:2px;">PLUG FOR THIS ORDER</div>
  <div style="font-size:56px;font-weight:900;line-height:1.1;">{{ plug }}</div>
  <div style="font-size:13px;">Ships to {{ shipping_address.country | default: c }}. Use this plug on every mains-powered item (hair dryer, styler, vacuum, espresso, ice cream maker, projector, 35W charger).</div>
  {%- if plug == 'EU' -%}<div style="font-size:13px;margin-top:4px;">No EU version of an item? Pack the US plug version plus an EU adapter.</div>{%- endif -%}
</div>
```

## The rule (same everywhere)

| Plug | Countries |
|---|---|
| **AU** | Australia, New Zealand, Fiji, Papua New Guinea, Tonga, Samoa, Vanuatu, Solomon Islands, Argentina, Uruguay, China |
| **UK** | United Kingdom, Ireland, Hong Kong, Singapore, Malaysia, UAE, Saudi Arabia, Qatar, Kuwait, Bahrain, Oman, Cyprus, Malta, Mauritius, Kenya, Nigeria, Ghana, Zimbabwe, Zambia, Uganda, Tanzania, Jersey, Guernsey, Isle of Man, Gibraltar, Macau, Brunei, Sri Lanka |
| **US** | United States, Canada, Mexico, Japan, Taiwan, Philippines, Thailand, Colombia, Ecuador, Peru, Venezuela, Puerto Rico, Central America, Caribbean, Brazil |
| **EU** | Everywhere else (most of Europe and the rest of the world) |

If you change the lists, change them in both places: this slip and `snippets/plug-type.liquid`.
