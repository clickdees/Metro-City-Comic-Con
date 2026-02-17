const SHOPIFY_CONFIG = {
  storeUrl: 'https://letstryh2.myshopify.com/api/graphql',
  token: 'f275315aab660b8b9bdf0fad52687c2c'
};

class ShopifyCartService {
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

      if (dataRoot.userErrors && dataRoot.userErrors.length > 0) {
        console.error("Shopify Error:", dataRoot.userErrors);
        return null;
      }

      const newCartId = dataRoot.cart.id;
      localStorage.setItem('__shopify:cartId', newCartId);
      
      // REMOVED: cartEl.setAttribute('id', ...) 
      // We do not want to change the DOM ID, or we break the UI.
      
      return newCartId;

    } catch (error) {
      console.error("Network Error:", error);
      return null;
    }
  }
}


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