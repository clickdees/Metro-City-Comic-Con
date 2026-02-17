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

// --- INITIALIZE OBSERVER ---
function initCartObserver() {
  const cartElement = document.getElementById('cart');
  
  // Wait for Shadow DOM
  const poller = setInterval(() => {
    if (cartElement && cartElement.shadowRoot) {
      clearInterval(poller);
      
      // 1. Run immediately
      injectCartAttributes();

      // 2. Watch for changes (re-renders) in the cart
      const observer = new MutationObserver((mutations) => {
        // Debounce slightly to prevent API spamming
        if(window.cartUpdateTimeout) clearTimeout(window.cartUpdateTimeout);
        window.cartUpdateTimeout = setTimeout(() => {
           injectCartAttributes();
           updateBadgeCount(cartElement); // Keep your badge logic too
        }, 300);
      });

      observer.observe(cartElement.shadowRoot, {
        childList: true,
        subtree: true
      });
    }
  }, 200);
}

// Badge Logic helper (from your previous code)
function updateBadgeCount(cartElement) {
   const badgeElement = document.getElementById('cart-count');
   const quantityElements = cartElement.shadowRoot.querySelectorAll('[data-testid="quantity-label"]');
   let totalQuantity = 0;
   quantityElements.forEach((element) => {
     totalQuantity += parseInt(element.textContent.trim(), 10);
   });
   if(badgeElement) {
       badgeElement.textContent = totalQuantity;
       badgeElement.style.display = totalQuantity > 0 ? 'flex' : 'none';
   }
}

// Start
document.addEventListener("DOMContentLoaded", initCartObserver);


class AdvancedBuyButton extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    this.shadowRoot.querySelector('button').addEventListener('click', () => this.handleClick());
  }

  async handleClick() {
    const btn = this.shadowRoot.querySelector('button');
    const originalText = this.innerText;
    
    // 1. GET VARIANT ID (From the hidden span we set up earlier)
    const idElement = document.getElementById('dynamic-variant-id');
    const variantId = idElement ? idElement.textContent.trim() : null;

    if (!variantId) {
      console.error("Variant ID not found.");
      btn.innerText = "Unavailable";
      return;
    }

    // 2. GET STATIC ATTRIBUTES (like gift-wrap="true")
    // We filter out any keys we don't want, or just take them all.
    // const attributes = Object.keys(this.dataset).map(key => ({
    //   key: key,
    //   value: this.dataset[key]
    // }));

    function formatAttribute(key) {
  // To get "gift-wrap"
      const kebabCase = key.replace(/([A-Z])/g, '-$1').toLowerCase();

      // To get "Gift Wrap"
      const titleCase = key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (str) => str.toUpperCase());

      return { kebabCase, titleCase };
    }

    // How you'd use it:
    const attributes = Object.keys(this.dataset).map(key => {
      const { kebabCase, titleCase } = formatAttribute(key);
      return {
        key: titleCase, // Or kebabCase, depending on what you need
        value: this.dataset[key]
      };
    });



    // 3. GET DYNAMIC ENGRAVING
    const engravingInput = document.getElementById('custom-engraving');
    if (engravingInput && engravingInput.value.trim() !== "") {
        attributes.push({
            key: "Engraving",
            value: engravingInput.value.trim()
        });
    }

    btn.innerText = "Processing...";

    // 4. ADD TO CART
    const success = await ShopifyCartService.addToCart(variantId, attributes);

    if (success) {
      btn.innerText = "Added!";
      
      // Clear the input after success
      if(engravingInput) engravingInput.value = '';

      // Refresh Drawer Logic
      const cartDrawer = document.getElementById('cart');
      if (cartDrawer) {
        const newCartDrawer = cartDrawer.cloneNode(true);
        cartDrawer.parentNode.replaceChild(newCartDrawer, cartDrawer);
        if (typeof newCartDrawer.showModal === 'function') {
          newCartDrawer.showModal();
        } else {
            // Fallback for older browsers or different states
            newCartDrawer.setAttribute('open', 'true');
        }
      } 
      
      setTimeout(() => btn.innerText = originalText, 2000);
    } else {
      btn.innerText = "Error";
      setTimeout(() => btn.innerText = originalText, 2000);
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
            transition: transform 0.2s;
        }
        button:hover {
            transform: translate(2px, 2px);
            box-shadow: 2px 2px 0 #000;
        }
      </style>
      <button><slot>Add Custom Item</slot></button>
    `;
  }
}

customElements.define('advanced-buy-button', AdvancedBuyButton);