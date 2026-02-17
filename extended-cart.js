const SHOPIFY_CONFIG = {
  storeUrl: 'https://letstryh2.myshopify.com/api/graphql',
  token: 'f275315aab660b8b9bdf0fad52687c2c'
};

class ShopifyCartService {
  // ... (Existing addToCart method remains here, no changes needed) ...
  static async addToCart(variantId, attributes = []) {
    let cartId = localStorage.getItem('__shopify:cartId');
    const mutation = cartId 
      ? `mutation cartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {
           cartLinesAdd(cartId: $cartId, lines: $lines) {
             cart { id }
             userErrors { field message }
           }
         }`
      : `mutation cartCreate($input: CartInput) {
           cartCreate(input: $input) {
             cart { id }
             userErrors { field message }
           }
         }`;

    const lineItem = {
      merchandiseId: variantId,
      quantity: 1,
      attributes: attributes
    };

    const variables = cartId 
      ? { cartId, lines: [lineItem] }
      : { input: { lines: [lineItem] } };

    try {
      const response = await fetch(SHOPIFY_CONFIG.storeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Storefront-Access-Token': SHOPIFY_CONFIG.token
        },
        body: JSON.stringify({ query: mutation, variables })
      });
      const result = await response.json();
      const dataRoot = cartId ? result.data.cartLinesAdd : result.data.cartCreate;
      if (dataRoot.userErrors && dataRoot.userErrors.length > 0) return null;
      
      const newCartId = dataRoot.cart.id;
      localStorage.setItem('__shopify:cartId', newCartId);
      return newCartId;
    } catch (error) {
      console.error("Network Error:", error);
      return null;
    }
  }

  // --- NEW METHOD: Fetch Cart Data to get Attributes ---
  static async fetchCartAttributes() {
    const cartId = localStorage.getItem('__shopify:cartId');
    if (!cartId) return [];

    const query = `query getCart($cartId: ID!) {
      cart(id: $cartId) {
        lines(first: 50) {
          edges {
            node {
              id
              attributes {
                key
                value
              }
            }
          }
        }
      }
    }`;

    try {
      const response = await fetch(SHOPIFY_CONFIG.storeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Storefront-Access-Token': SHOPIFY_CONFIG.token
        },
        body: JSON.stringify({ query: query, variables: { cartId } })
      });
      const result = await response.json();
      // Flatten the structure for easier lookup
      return result.data.cart.lines.edges.map(edge => ({
        id: edge.node.id,
        attributes: edge.node.attributes
      }));
    } catch (e) {
      console.error("Error fetching attributes", e);
      return [];
    }
  }
}

// --- LOGIC TO INJECT ATTRIBUTES INTO SHADOW DOM ---
async function injectCartAttributes() {
  
  const cartElement = document.getElementById('cart');
  if (!cartElement || !cartElement.shadowRoot) return;

  // Add this INSIDE injectCartAttributes, at the very top:

  if (!cartElement.shadowRoot.querySelector('#comic-cart-styles')) {
    const style = document.createElement('style');
    style.id = 'comic-cart-styles';
    style.textContent = `
      .custom-attributes-injected {
          margin-top: -20px;
          padding-top: 10px;
          border-top: 1px dashed #ccc;
          margin-bottom: 10px;
      }
      .comic-attr-line {
        font-family: 'Special Elite', monospace; /* We assume this font loads in the shadow DOM or inherits */
        font-size: 0.9em;
        color: #e74c3c;
        display: flex;
        gap: 5px;
      }
      .comic-attr-key {
        font-weight: bold;
        text-transform: uppercase;
      }
      .comic-attr-val {
        color: #333;
      }
    `;
    cartElement.shadowRoot.appendChild(style);
  }

  // 1. Get the data from Shopify API
  const cartLinesData = await ShopifyCartService.fetchCartAttributes();
  if (cartLinesData.length === 0) return;

  // 2. Find all line items in the Shadow DOM
  const lineItems = cartElement.shadowRoot.querySelectorAll('.line-item-container');

  lineItems.forEach(row => {
    // The DOM ID looks like "gid://shopify/CartLine/...?cart=..."
    // The API ID looks like "gid://shopify/CartLine/...?cart=..."
    // We match them up.
    const rawLineId = row.getAttribute('line--id');
    
    // Find the matching data object
    const lineData = cartLinesData.find(d => rawLineId.includes(d.id));

    if (lineData && lineData.attributes.length > 0) {
      const detailsContainer = row.querySelector('.line-details');
      
      // Check if we already injected it to avoid duplicates
      if (!detailsContainer.querySelector('.custom-attributes-injected')) {
        
        const attrDiv = document.createElement('div');
        attrDiv.className = 'custom-attributes-injected';
        
        // Build the HTML for attributes
        let html = '';
        lineData.attributes.forEach(attr => {
          // Filter out internal properties (starting with _) if any
          if(!attr.key.startsWith('_')) {
            html += `<div class="comic-attr-line">
              <span class="comic-attr-key">${attr.key}:</span> 
              <span class="comic-attr-val">${attr.value}</span>
            </div>`;
          }
        });

        attrDiv.innerHTML = html;
        
        // Append after the variants
        const variantsDiv = detailsContainer.querySelector('.line-options');
        if (variantsDiv) {
            variantsDiv.after(attrDiv);
        } else {
            detailsContainer.appendChild(attrDiv);
        }
      }
    }
  });
}

// --- ADVANCED CART MONITORING ---
function initCartAttributeObserver() {
  const cartElement = document.getElementById('cart');
  
  // 1. Wait for Shadow DOM to be ready (Polling)
  const poller = setInterval(() => {
    if (cartElement && cartElement.shadowRoot) {
      clearInterval(poller);
      
      // A. Initial Injection (in case it's already open)
      injectCartAttributes();
      // Also update the badge immediately
      updateBadgeCount(cartElement); 

      // --- TRIGGER 1: Watch the Internal Dialog for "Open" ---
      const internalDialog = cartElement.shadowRoot.querySelector('dialog');
      if (internalDialog) {
        const dialogObserver = new MutationObserver((mutations) => {
          mutations.forEach((mutation) => {
            // Check if the 'open' attribute changed
            if (mutation.type === 'attributes' && mutation.attributeName === 'open') {
              if (internalDialog.hasAttribute('open')) {
                // Cart just opened! Fetch and Inject.
                injectCartAttributes(); 
              }
            }
          });
        });
        
        // Only watch for attribute changes on the dialog
        dialogObserver.observe(internalDialog, { 
          attributes: true, 
          attributeFilter: ['open'] 
        });
      }

      // --- TRIGGER 2: Watch for Shopify's Re-Render Event ---
      // The component dispatches 'shopify-render' whenever it redraws the HTML.
      // This covers quantity changes, remove items, etc.
      document.addEventListener('shopify-render', () => {
         // Debounce slightly to let the DOM settle
         setTimeout(() => {
           injectCartAttributes();
           updateBadgeCount(cartElement);
         }, 50);
      });

      // --- TRIGGER 3: Fallback Badge Observer (Your original logic) ---
      // We still keep this to update the BADGE on page load or simple DOM shifts
      const badgeObserver = new MutationObserver(() => {
         updateBadgeCount(cartElement);
      });
      badgeObserver.observe(cartElement.shadowRoot, {
         childList: true, 
         subtree: true 
      });
    }
  }, 200);
}

// Badge Logic (Moved out for cleanliness)
function updateBadgeCount(cartElement) {
   const badgeElement = document.getElementById('cart-count');
   // Only try to update if the elements exist
   if (!badgeElement || !cartElement.shadowRoot) return;

   const quantityElements = cartElement.shadowRoot.querySelectorAll('[data-testid="quantity-label"]');
   let totalQuantity = 0;
   
   quantityElements.forEach((element) => {
     totalQuantity += parseInt(element.textContent.trim(), 10) || 0;
   });

   badgeElement.textContent = totalQuantity;
   
   // Animation for badge
   if (totalQuantity > 0) {
       badgeElement.style.display = 'flex';
   } else {
       badgeElement.style.display = 'none';
   }
}

// 2. Run on initial page load
document.addEventListener("DOMContentLoaded", initCartAttributeObserver);

// 3. Run whenever our custom script tells us the cart was replaced (if you still use replaceChild)
document.addEventListener("cart-refreshed", initCartAttributeObserver);


class AdvancedBuyButton extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    this.btn = this.shadowRoot.querySelector('button');
    this.btn.addEventListener('click', () => this.handleClick());

    // START MONITORING AVAILABILITY
    this.initAvailabilityObserver();
  }

  initAvailabilityObserver() {
    const statusElement = document.getElementById('dynamic-available-status');
    
    if (!statusElement) return;

    // Logic to enable/disable button based on text content
    const updateState = () => {
      // The shopify-data tag outputs "true" or "false" as text
      const isAvailable = statusElement.textContent.trim().toLowerCase() === 'true';
      
      if (isAvailable) {
        this.btn.removeAttribute('disabled');
        this.btn.innerHTML = '<slot>Add Custom Item</slot>'; 
      } else {
        this.btn.setAttribute('disabled', 'true');
        this.btn.innerText = "OUT OF STOCK";
      }
    };

    setTimeout(updateState, 50);

    const observer = new MutationObserver(updateState);
    observer.observe(statusElement, { 
      characterData: true, 
      childList: true, 
      subtree: true 
    });
  }

  async handleClick() {
    if (this.btn.hasAttribute('disabled')) return;

    const originalText = this.innerHTML;
    
    // 1. GET VARIANT ID
    const idElement = document.getElementById('dynamic-variant-id');
    const variantId = idElement ? idElement.textContent.trim() : null;

    if (!variantId) {
      console.error("Variant ID not found.");
      return;
    }

    // 2. GET STATIC ATTRIBUTES
    const attributes = Object.keys(this.dataset).map(key => ({
      key: key,
      value: this.dataset[key]
    }));

    // 3. GET DYNAMIC ENGRAVING
    const engravingInput = document.getElementById('custom-engraving');
    if (engravingInput && engravingInput.value.trim() !== "") {
        attributes.push({
            key: "Monogram",
            value: engravingInput.value.trim()
        });
    }

    this.btn.innerText = "Processing...";

    // 4. ADD TO CART
    const success = await ShopifyCartService.addToCart(variantId, attributes);

    if (success) {
      this.btn.innerText = "Added!";
      if(engravingInput) engravingInput.value = '';

      // --- CRITICAL FIX START ---
      const cartDrawer = document.getElementById('cart');
      
      if (cartDrawer) {
        // A. Clone the cart node. This creates a fresh instance of the web component.
        const newCartDrawer = cartDrawer.cloneNode(true);
        
        // B. Replace the old cart with the new one. 
        // This forces the component's 'connectedCallback' to run again, 
        // fetching the new data from Shopify.
        cartDrawer.parentNode.replaceChild(newCartDrawer, cartDrawer);

        // C. Re-initialize our custom observers (Engraving text, Badge count)
        // We call this manually because the old observer was attached to the deleted node.
        if (typeof initCartAttributeObserver === 'function') {
            initCartAttributeObserver(); 
        }

        // D. Open the NEW drawer
        // We use a tiny timeout to ensure the Shadow DOM is ready before calling methods on it.
        setTimeout(() => {
            if (typeof newCartDrawer.showModal === 'function') {
              newCartDrawer.showModal();
            } else if (typeof newCartDrawer.show === 'function') {
              newCartDrawer.show();
            } else {
              newCartDrawer.setAttribute('open', 'true');
            }
        }, 100);
      } 
      // --- CRITICAL FIX END ---
      
      setTimeout(() => this.btn.innerHTML = '<slot>Add Custom Item</slot>', 2000);
    } else {
      this.btn.innerText = "Error";
      setTimeout(() => this.btn.innerHTML = '<slot>Add Custom Item</slot>', 2000);
    }
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        button {
            background: #3498db; 
            color: #fff; 
            padding: 15px 25px; 
            font-family: 'Bangers', cursive;
            font-size: 1.8em;
            border: 3px solid #000;
            cursor: pointer;
            box-shadow: 4px 4px 0 #000;
            width: 100%;
            text-transform: uppercase;
            -webkit-text-stroke: 1px #000;
            transition: all 0.2s;
        }
        button:hover {
            transform: translate(2px, 2px);
            box-shadow: 2px 2px 0 #000;
        }
        button:disabled, button[disabled] {
            background: #95a5a6;
            cursor: not-allowed;
            box-shadow: none;
            transform: translate(4px, 4px);
            opacity: 0.7;
            pointer-events: none;
        }
      </style>
      <button><slot>Add Custom Item</slot></button>
    `;
  }
}


customElements.define('advanced-buy-button', AdvancedBuyButton);