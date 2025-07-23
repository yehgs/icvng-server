// scripts/seedBlogData.js
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import BlogCategoryModel from '../models/blog-category.model.js';
import BlogTagModel from '../models/blog-tag.model.js';
import BlogPostModel from '../models/blog-post.model.js';
import UserModel from '../models/user.model.js';

dotenv.config();

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

const seedBlogData = async () => {
  try {
    console.log('Starting blog data seeding...');

    // Find or create an admin user to be the author
    let adminUser = await UserModel.findOne({
      role: 'ADMIN',
      subRole: 'EDITOR',
    });

    if (!adminUser) {
      adminUser = await UserModel.findOne({ role: 'ADMIN' });
    }

    if (!adminUser) {
      console.error('No admin user found. Please create an admin user first.');
      process.exit(1);
    }

    console.log(`Using admin user: ${adminUser.name} as author`);

    // Create blog categories
    const categories = [
      {
        name: 'Coffee Origins',
        description:
          'Explore the fascinating origins of coffee beans from around the world',
        seoTitle: 'Coffee Origins - Learn Bean Origins | I-Coffee.ng',
        seoDescription:
          'Discover the rich history and unique characteristics of coffee beans from different regions around the world.',
        seoKeywords:
          'coffee origins, coffee beans, coffee regions, arabica, robusta, coffee farms',
      },
      {
        name: 'Brewing Techniques',
        description:
          'Master the art of coffee brewing with expert tips and techniques',
        seoTitle: 'Coffee Brewing Techniques | I-Coffee.ng',
        seoDescription:
          'Learn professional coffee brewing techniques to make the perfect cup at home.',
        seoKeywords:
          'coffee brewing, brewing techniques, pour over, espresso, french press',
      },
      {
        name: 'Coffee Culture',
        description:
          'Dive into the rich culture and traditions surrounding coffee',
        seoTitle: 'Coffee Culture & Traditions | I-Coffee.ng',
        seoDescription:
          'Explore coffee culture and traditions from around the world.',
        seoKeywords:
          'coffee culture, coffee traditions, coffee history, coffee ceremony',
      },
    ];

    const createdCategories = [];
    for (const categoryData of categories) {
      let category = await BlogCategoryModel.findOne({
        name: categoryData.name,
      });
      if (!category) {
        category = new BlogCategoryModel(categoryData);
        await category.save();
        console.log(`Created category: ${category.name}`);
      }
      createdCategories.push(category);
    }

    // Create blog tags
    const tags = [
      {
        name: 'Arabica',
        description: 'High-quality coffee bean variety',
        color: '#8B4513',
      },
      {
        name: 'Robusta',
        description: 'Strong and bitter coffee bean variety',
        color: '#654321',
      },
      {
        name: 'Single Origin',
        description: 'Coffee from a specific region or farm',
        color: '#228B22',
      },
      {
        name: 'Fair Trade',
        description: 'Ethically sourced coffee',
        color: '#32CD32',
      },
      {
        name: 'Organic',
        description: 'Organically grown coffee',
        color: '#90EE90',
      },
      {
        name: 'Dark Roast',
        description: 'Dark roasted coffee beans',
        color: '#2F4F4F',
      },
      {
        name: 'Medium Roast',
        description: 'Medium roasted coffee beans',
        color: '#A0522D',
      },
      {
        name: 'Light Roast',
        description: 'Light roasted coffee beans',
        color: '#D2B48C',
      },
      {
        name: 'Ethiopia',
        description: 'Coffee from Ethiopia',
        color: '#DC143C',
      },
      {
        name: 'Colombia',
        description: 'Coffee from Colombia',
        color: '#FFD700',
      },
      { name: 'Jamaica', description: 'Coffee from Jamaica', color: '#00FF00' },
      { name: 'Brazil', description: 'Coffee from Brazil', color: '#008000' },
    ];

    const createdTags = [];
    for (const tagData of tags) {
      let tag = await BlogTagModel.findOne({ name: tagData.name });
      if (!tag) {
        tag = new BlogTagModel(tagData);
        await tag.save();
        console.log(`Created tag: ${tag.name}`);
      }
      createdTags.push(tag);
    }

    // Get Coffee Origins category
    const coffeeOriginsCategory = createdCategories.find(
      (cat) => cat.name === 'Coffee Origins'
    );

    // Create blog posts for Coffee Origins
    const blogPosts = [
      {
        title: 'The Ethiopian Coffee Story: Birthplace of Coffee',
        excerpt:
          'Discover the legendary birthplace of coffee in the highlands of Ethiopia, where coffee culture began over a thousand years ago.',
        content: `<h2>The Legend of Kaldi and the Dancing Goats</h2>
        <p>The story of coffee begins in the ancient highlands of Ethiopia, where legend tells of a goat herder named Kaldi who noticed his goats becoming unusually energetic after eating certain red berries. This discovery would eventually change the world forever.</p>
        
        <h3>Ethiopian Coffee Regions</h3>
        <p>Ethiopia produces some of the world's finest coffee beans, with distinct regions offering unique flavor profiles:</p>
        <ul>
        <li><strong>Yirgacheffe:</strong> Known for its bright acidity and floral notes</li>
        <li><strong>Sidamo:</strong> Full-bodied with wine-like characteristics</li>
        <li><strong>Harrar:</strong> Bold and earthy with berry undertones</li>
        </ul>
        
        <h3>Traditional Coffee Ceremony</h3>
        <p>The Ethiopian coffee ceremony is a beautiful tradition that brings communities together. Green coffee beans are roasted over an open flame, ground by hand, and brewed in a clay pot called a jebena. This ritual can take hours and represents hospitality and friendship.</p>
        
        <h3>Modern Ethiopian Coffee</h3>
        <p>Today, Ethiopia remains one of the world's top coffee producers, with over 15 million people depending on coffee for their livelihood. The country exports high-quality beans while maintaining its rich coffee traditions.</p>`,
        featuredImage:
          'https://images.unsplash.com/photo-1447933601403-0c6688de566e?w=800',
        imageAlt: 'Ethiopian coffee ceremony with traditional jebena pot',
        category: coffeeOriginsCategory._id,
        tags: [
          createdTags.find((t) => t.name === 'Ethiopia')._id,
          createdTags.find((t) => t.name === 'Arabica')._id,
          createdTags.find((t) => t.name === 'Single Origin')._id,
        ],
        author: adminUser._id,
        status: 'PUBLISHED',
        seoTitle: 'Ethiopian Coffee Origins - Birthplace | I-Coffee.ng',
        seoDescription:
          'Learn about Ethiopian coffee origins, from the legend of Kaldi to modern coffee regions like Yirgacheffe and Sidamo.',
        seoKeywords:
          'Ethiopian coffee, coffee origins, Yirgacheffe, Sidamo, Harrar, coffee ceremony',
      },
      {
        title: 'Colombian Coffee: The Perfect Climate for Perfect Beans',
        excerpt:
          "Explore how Colombia's unique geography and climate create some of the world's most beloved coffee beans.",
        content: `<h2>Colombia's Coffee Triangle</h2>
        <p>Colombia's Eje Cafetero (Coffee Triangle) consists of three departments: Caldas, Quindío, and Risaralda. This region benefits from optimal altitude, temperature, and rainfall for growing exceptional Arabica coffee.</p>
        
        <h3>The Colombian Coffee Character</h3>
        <p>Colombian coffee is renowned for its:</p>
        <ul>
        <li>Balanced flavor profile with medium body</li>
        <li>Bright acidity with caramel sweetness</li>
        <li>Clean finish with nutty undertones</li>
        <li>Consistent quality year-round</li>
        </ul>
        
        <h3>Sustainable Farming Practices</h3>
        <p>Colombian coffee farmers have embraced sustainable farming methods, including shade-grown cultivation that preserves biodiversity and soil health. Many farms are now certified organic and fair trade.</p>
        
        <h3>The Role of Juan Valdez</h3>
        <p>The fictional character Juan Valdez, created in 1958, became the face of Colombian coffee worldwide. This marketing campaign successfully established Colombia as a premium coffee origin in consumers' minds.</p>
        
        <h3>Processing Methods</h3>
        <p>Colombian coffee is typically processed using the washed method, which involves removing the cherry pulp before drying. This process highlights the bean's natural flavors and creates the clean, bright taste Colombian coffee is known for.</p>`,
        featuredImage:
          'https://images.unsplash.com/photo-1442550528053-c431ecb55509?w=800',
        imageAlt: 'Colombian coffee plantation in the mountains',
        category: coffeeOriginsCategory._id,
        tags: [
          createdTags.find((t) => t.name === 'Colombia')._id,
          createdTags.find((t) => t.name === 'Arabica')._id,
          createdTags.find((t) => t.name === 'Fair Trade')._id,
          createdTags.find((t) => t.name === 'Medium Roast')._id,
        ],
        author: adminUser._id,
        status: 'PUBLISHED',
        seoTitle: 'Colombian Coffee Origins - Coffee Triangle',
        seoDescription:
          'Discover Colombian coffee origins, the Coffee Triangle region, and what makes Colombian beans special.',
        seoKeywords:
          'Colombian coffee, Coffee Triangle, Arabica, Juan Valdez, sustainable farming',
      },
      {
        title: "Jamaica Blue Mountain: The World's Most Expensive Coffee",
        excerpt:
          'Uncover the secrets behind Jamaica Blue Mountain coffee, one of the rarest and most sought-after coffees in the world.',
        content: `<h2>The Crown Jewel of Coffee</h2>
        <p>Jamaica Blue Mountain coffee is grown in the Blue Mountain range of Jamaica, specifically in parishes of Portland, St. Andrew, St. Thomas, and St. Mary. This coffee commands premium prices due to its exceptional quality and limited production.</p>
        
        <h3>Unique Growing Conditions</h3>
        <p>The Blue Mountains provide ideal conditions for coffee cultivation:</p>
        <ul>
        <li>High altitude (3,000-5,500 feet above sea level)</li>
        <li>Cool temperatures and consistent rainfall</li>
        <li>Rich, well-draining volcanic soil</li>
        <li>Frequent cloud cover that filters sunlight</li>
        </ul>
        
        <h3>Flavor Profile</h3>
        <p>Jamaica Blue Mountain coffee is celebrated for its:</p>
        <ul>
        <li>Mild flavor with no bitterness</li>
        <li>Perfect balance of acidity and body</li>
        <li>Subtle floral and nutty notes</li>
        <li>Clean, smooth finish</li>
        </ul>
        
        <h3>Strict Quality Control</h3>
        <p>The Coffee Industry Board of Jamaica maintains strict quality standards. All coffee must be grown in designated areas, processed according to specific guidelines, and pass rigorous quality tests before receiving certification.</p>
        
        <h3>Limited Production</h3>
        <p>Only about 1,000 tons of certified Jamaica Blue Mountain coffee is produced annually, making it extremely rare. Most of the production is exported to Japan, which has been the primary market since the 1960s.</p>`,
        featuredImage:
          'https://images.unsplash.com/photo-1497935586351-b67a49e012bf?w=800',
        imageAlt:
          'Jamaica Blue Mountain coffee plantation with misty mountains',
        category: coffeeOriginsCategory._id,
        tags: [
          createdTags.find((t) => t.name === 'Jamaica')._id,
          createdTags.find((t) => t.name === 'Arabica')._id,
          createdTags.find((t) => t.name === 'Single Origin')._id,
          createdTags.find((t) => t.name === 'Light Roast')._id,
        ],
        author: adminUser._id,
        status: 'PUBLISHED',
        seoTitle: 'Jamaica Blue Mountain - Worlds Most Expensive Coffee',
        seoDescription:
          "Learn about Jamaica Blue Mountain coffee, its unique growing conditions, and why it's considered the world's finest coffee.",
        seoKeywords:
          'Jamaica Blue Mountain, expensive coffee, premium coffee, Arabica, coffee quality',
      },
      {
        title: 'Brazilian Coffee: The Giant of Global Coffee Production',
        excerpt:
          "Learn about Brazil's dominance in the coffee world and the diverse regions that produce everything from commodity to specialty grade beans.",
        content: `<h2>The Coffee Powerhouse</h2>
        <p>Brazil is the world's largest coffee producer, accounting for about one-third of global coffee production. The country has been the top producer for over 150 years, with vast plantations spanning multiple states.</p>
        
        <h3>Major Coffee Regions</h3>
        <p>Brazil's diverse geography creates distinct coffee regions:</p>
        <ul>
        <li><strong>Minas Gerais:</strong> Produces 50% of Brazil's coffee, known for chocolatey, nutty flavors</li>
        <li><strong>São Paulo:</strong> Historic coffee region with both arabica and robusta</li>
        <li><strong>Espírito Santo:</strong> Primary robusta producer, ideal for espresso blends</li>
        <li><strong>Bahia:</strong> Emerging region producing high-quality specialty coffee</li>
        </ul>
        
        <h3>Natural Processing Method</h3>
        <p>Brazil pioneered the natural (dry) processing method, where coffee cherries are dried with the fruit still attached to the bean. This creates unique flavor profiles with heavy body and lower acidity.</p>
        
        <h3>From Plantation to Specialty</h3>
        <p>While Brazil is known for commodity coffee, the country has increasingly focused on specialty coffee production. Many farms now produce microlots with unique flavor profiles that compete with the world's best coffees.</p>
        
        <h3>Sustainable Initiatives</h3>
        <p>Brazilian coffee farms are implementing sustainable practices including rainforest certification, organic farming, and direct trade relationships with roasters worldwide.</p>`,
        featuredImage:
          'https://images.unsplash.com/photo-1559056199-641a0ac8b55e?w=800',
        imageAlt: 'Brazilian coffee plantation with vast rows of coffee plants',
        category: coffeeOriginsCategory._id,
        tags: [
          createdTags.find((t) => t.name === 'Brazil')._id,
          createdTags.find((t) => t.name === 'Arabica')._id,
          createdTags.find((t) => t.name === 'Robusta')._id,
          createdTags.find((t) => t.name === 'Dark Roast')._id,
        ],
        author: adminUser._id,
        status: 'PUBLISHED',
        seoTitle: 'Brazilian Coffee Origins - Worlds Largest Producer',
        seoDescription:
          'Explore Brazilian coffee regions, processing methods, and the transition from commodity to specialty coffee.',
        seoKeywords:
          'Brazilian coffee, Minas Gerais, coffee production, natural process, specialty coffee',
      },
      {
        title: 'Central American Coffee: A Region of Excellence',
        excerpt:
          'Discover the unique characteristics of Central American coffee regions and their contribution to the specialty coffee world.',
        content: `<h2>The Volcanic Advantage</h2>
        <p>Central American countries benefit from volcanic soil, high altitudes, and ideal climates that produce some of the world's finest coffee. The region includes Guatemala, Costa Rica, Honduras, Nicaragua, El Salvador, and Panama.</p>
        
        <h3>Guatemala - Complex and Full-Bodied</h3>
        <p>Guatemalan coffee is known for its full body, rich chocolate notes, and spicy finish. The Antigua region produces particularly prized beans with a distinctive smoky character from volcanic soil.</p>
        
        <h3>Costa Rica - Bright and Clean</h3>
        <p>Costa Rican coffee features bright acidity, medium body, and clean flavors. The country focuses exclusively on arabica and has strict quality standards. The Tarrazú region is especially renowned.</p>
        
        <h3>Panama - Home of Geisha Coffee</h3>
        <p>Panama gained international recognition for its Geisha variety coffee, which has set record prices at auctions. The country's diverse microclimates produce exceptional specialty coffees.</p>
        
        <h3>Processing Innovation</h3>
        <p>Central American countries have pioneered innovative processing methods including honey processing, which removes some but not all of the fruit mucilage, creating unique flavor profiles.</p>
        
        <h3>Sustainable Practices</h3>
        <p>The region leads in sustainable coffee farming, with many farms certified organic, fair trade, and Rainforest Alliance. Shade-grown coffee helps preserve bird habitats and biodiversity.</p>`,
        featuredImage:
          'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=800',
        imageAlt: 'Central American coffee farm on volcanic mountainside',
        category: coffeeOriginsCategory._id,
        tags: [
          createdTags.find((t) => t.name === 'Arabica')._id,
          createdTags.find((t) => t.name === 'Single Origin')._id,
          createdTags.find((t) => t.name === 'Fair Trade')._id,
          createdTags.find((t) => t.name === 'Organic')._id,
        ],
        author: adminUser._id,
        status: 'PUBLISHED',
        seoTitle: 'Central American Coffee - Guatemala, Costa Rica & More',
        seoDescription:
          'Explore Central American coffee regions known for exceptional quality, from Guatemalan Antigua to Panamanian Geisha.',
        seoKeywords:
          'Central American coffee, Guatemala, Costa Rica, Panama, Geisha coffee, volcanic soil',
      },
      {
        title: 'African Coffee Diversity: Beyond Ethiopia',
        excerpt:
          "Explore the diverse coffee landscape of Africa, from Kenya's bright acidity to Rwanda's remarkable coffee renaissance.",
        content: `<h2>A Continent of Coffee Diversity</h2>
        <p>While Ethiopia is the birthplace of coffee, the entire African continent produces exceptional beans with unique characteristics. Each country offers distinct flavor profiles shaped by terroir, processing methods, and local traditions.</p>
        
        <h3>Kenya - The King of Brightness</h3>
        <p>Kenyan coffee is famous for its wine-like acidity, full body, and black currant notes. The country's unique double fermentation process and high-altitude growing conditions create distinctive flavors that coffee enthusiasts cherish.</p>
        
        <h3>Rwanda - The Land of a Thousand Hills</h3>
        <p>Rwanda's coffee industry has experienced remarkable growth since the 1990s. The country produces bright, clean coffees with floral and citrus notes. Rwanda's focus on quality and sustainability has earned international recognition.</p>
        
        <h3>Tanzania - Mount Kilimanjaro Coffee</h3>
        <p>Tanzanian coffee, particularly from the slopes of Mount Kilimanjaro, offers medium body with wine-like acidity and rich, complex flavors. The Peaberry beans from Tanzania are especially prized.</p>
        
        <h3>Burundi - Hidden Gem</h3>
        <p>Burundi produces exceptional coffee with bright acidity, medium body, and complex fruit flavors. Despite challenges, the country's focus on quality is gaining international attention.</p>
        
        <h3>Processing Methods</h3>
        <p>African countries employ various processing methods:</p>
        <ul>
        <li>Washed process: Highlights bright acidity and clean flavors</li>
        <li>Natural process: Creates fruity, wine-like characteristics</li>
        <li>Honey process: Balances sweetness and acidity</li>
        </ul>`,
        featuredImage:
          'https://images.unsplash.com/photo-1518832519375-e4ec2aa36848?w=800',
        imageAlt: 'African coffee farmers harvesting ripe coffee cherries',
        category: coffeeOriginsCategory._id,
        tags: [
          createdTags.find((t) => t.name === 'Arabica')._id,
          createdTags.find((t) => t.name === 'Single Origin')._id,
          createdTags.find((t) => t.name === 'Fair Trade')._id,
          createdTags.find((t) => t.name === 'Medium Roast')._id,
        ],
        author: adminUser._id,
        status: 'PUBLISHED',
        seoTitle: 'African Coffee Origins - Kenya, Rwanda, Tanzania',
        seoDescription:
          "Discover African coffee origins beyond Ethiopia, including Kenya's bright acidity and Rwanda's coffee renaissance.",
        seoKeywords:
          'African coffee, Kenyan coffee, Rwanda coffee, Tanzania, Burundi, coffee processing',
      },
      {
        title: 'Indonesian Coffee: Unique Island Flavors',
        excerpt:
          "Discover the distinctive coffee flavors from Indonesia's diverse islands, from Sumatra's earthiness to Java's heritage.",
        content: `<h2>Island Coffee Paradise</h2>
        <p>Indonesia's archipelago of over 17,000 islands provides diverse microclimates perfect for coffee cultivation. The country is the world's fourth-largest coffee producer, known for unique processing methods and distinctive flavors.</p>
        
        <h3>Sumatra - Earthy and Bold</h3>
        <p>Sumatran coffee is famous for its full body, low acidity, and earthy, herbal flavors. The unique "wet-hulling" (Giling Basah) process creates the characteristic heavy body and rustic flavors that Sumatra is known for.</p>
        
        <h3>Java - Coffee Heritage</h3>
        <p>Java gave coffee its nickname and has been producing coffee since the Dutch colonial period. Javanese coffee offers full body, low acidity, and rustic flavors. The island produces both arabica and robusta varieties.</p>
        
        <h3>Sulawesi (Celebes) - Complex and Balanced</h3>
        <p>Sulawesi coffee is known for its full body, low acidity, and complex flavor profile with herbal and spicy notes. The Toraja region produces particularly prized beans with unique processing methods.</p>
        
        <h3>Kopi Luwak - The Controversial Coffee</h3>
        <p>Indonesia is home to Kopi Luwak, one of the world's most expensive coffees. Made from beans that have passed through the digestive system of civets, this coffee has sparked debate about ethics and authenticity.</p>
        
        <h3>Wet-Hulling Process</h3>
        <p>Indonesia's unique wet-hulling process involves removing the parchment while the beans still have high moisture content. This creates the characteristic blue-green color and contributes to the distinctive flavor profile of Indonesian coffees.</p>`,
        featuredImage:
          'https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=800',
        imageAlt: 'Indonesian coffee plantation on volcanic slopes',
        category: coffeeOriginsCategory._id,
        tags: [
          createdTags.find((t) => t.name === 'Arabica')._id,
          createdTags.find((t) => t.name === 'Robusta')._id,
          createdTags.find((t) => t.name === 'Single Origin')._id,
          createdTags.find((t) => t.name === 'Dark Roast')._id,
        ],
        author: adminUser._id,
        status: 'PUBLISHED',
        seoTitle: 'Indonesian Coffee Origins - Sumatra, Java & Islands',
        seoDescription:
          "Explore Indonesian coffee from Sumatra's earthy flavors to Java's heritage and unique wet-hulling processing.",
        seoKeywords:
          'Indonesian coffee, Sumatra, Java, Sulawesi, wet-hulling, Kopi Luwak',
      },
      {
        title: 'Yemen Mocha: Ancient Coffee Traditions',
        excerpt:
          "Explore the ancient coffee traditions of Yemen, where the port of Mocha gave its name to one of coffee's most famous varieties.",
        content: `<h2>The Ancient Coffee Trade</h2>
        <p>Yemen has one of the oldest coffee traditions in the world, dating back to the 15th century. The port city of Mocha (Al Mukha) was once the world's primary coffee trading hub, giving its name to the famous Mocha coffee.</p>
        
        <h3>Historical Significance</h3>
        <p>Yemeni traders were the first to cultivate coffee commercially and established the global coffee trade. For centuries, Yemen was the world's only coffee exporter, closely guarding the secrets of cultivation.</p>
        
        <h3>Unique Growing Conditions</h3>
        <p>Yemeni coffee is grown on ancient terraced mountainsides at altitudes up to 8,000 feet. The arid climate and traditional farming methods create coffee with distinctive characteristics:</p>
        <ul>
        <li>Wine-like acidity and complexity</li>
        <li>Chocolate and fruit undertones</li>
        <li>Medium to full body</li>
        <li>Distinctive "wild" flavor profile</li>
        </ul>
        
        <h3>Traditional Processing</h3>
        <p>Yemeni coffee is processed using ancient natural (dry) methods. Cherries are dried on rooftops and stone patios, creating unique flavors that can't be replicated elsewhere.</p>
        
        <h3>Challenges and Revival</h3>
        <p>Political instability and water scarcity have challenged Yemen's coffee industry. However, specialty coffee enthusiasts and importers are working to revive this ancient coffee tradition and support Yemeni farmers.</p>
        
        <h3>Mocha Coffee Today</h3>
        <p>While the term "mocha" now often refers to chocolate-coffee drinks, true Yemen Mocha coffee remains one of the world's most distinctive and sought-after origins.</p>`,
        featuredImage:
          'https://images.unsplash.com/photo-1610889556528-9a770e32642f?w=800',
        imageAlt: 'Ancient Yemeni coffee terraces on mountain slopes',
        category: coffeeOriginsCategory._id,
        tags: [
          createdTags.find((t) => t.name === 'Arabica')._id,
          createdTags.find((t) => t.name === 'Single Origin')._id,
          createdTags.find((t) => t.name === 'Medium Roast')._id,
          createdTags.find((t) => t.name === 'Fair Trade')._id,
        ],
        author: adminUser._id,
        status: 'PUBLISHED',
        seoTitle: 'Yemen Mocha Coffee - Ancient Coffee Traditions',
        seoDescription:
          'Learn about Yemen Mocha coffee, ancient coffee traditions, and the historical significance of the Mocha port.',
        seoKeywords:
          'Yemen Mocha, ancient coffee, coffee history, Mocha port, traditional processing',
      },
      {
        title: "Hawaiian Kona: America's Only Commercial Coffee",
        excerpt:
          'Learn about Hawaiian Kona coffee, the only commercially grown coffee in the United States, and what makes it so special.',
        content: `<h2>Paradise Coffee</h2>
        <p>Hawaiian Kona coffee is the only commercially grown coffee in the United States. Grown on the volcanic slopes of the Big Island's Hualalai and Mauna Loa mountains, Kona coffee is protected by strict regulations and geographic boundaries.</p>
        
        <h3>Perfect Growing Conditions</h3>
        <p>The Kona region provides ideal conditions for coffee cultivation:</p>
        <ul>
        <li>Volcanic soil rich in minerals</li>
        <li>Perfect elevation (800-2,500 feet)</li>
        <li>Consistent temperatures (65-75°F)</li>
        <li>Regular rainfall and afternoon cloud cover</li>
        <li>Protection from trade winds by Mauna Loa</li>
        </ul>
        
        <h3>Flavor Profile</h3>
        <p>Authentic Kona coffee is known for:</p>
        <ul>
        <li>Smooth, rich flavor with low acidity</li>
        <li>Nutty and chocolatey notes</li>
        <li>Clean, crisp finish</li>
        <li>Medium body with excellent balance</li>
        </ul>
        
        <h3>Strict Quality Standards</h3>
        <p>Hawaii has strict laws protecting the Kona name. Only coffee grown in designated areas can be called "Kona coffee." The state grades Kona coffee from Extra Fancy (highest) to Prime (lowest).</p>
        
        <h3>Small-Scale Farming</h3>
        <p>Most Kona coffee is grown on small family farms, many less than 5 acres. This artisanal approach ensures attention to detail and quality that larger plantations can't match.</p>
        
        <h3>Sustainability Efforts</h3>
        <p>Kona farmers are implementing sustainable practices including organic farming, water conservation, and renewable energy use to protect Hawaii's unique ecosystem.</p>`,
        featuredImage:
          'https://images.unsplash.com/photo-1545558014-8692077e9b5c?w=800',
        imageAlt: 'Hawaiian Kona coffee plantation with ocean view',
        category: coffeeOriginsCategory._id,
        tags: [
          createdTags.find((t) => t.name === 'Arabica')._id,
          createdTags.find((t) => t.name === 'Single Origin')._id,
          createdTags.find((t) => t.name === 'Medium Roast')._id,
          createdTags.find((t) => t.name === 'Organic')._id,
        ],
        author: adminUser._id,
        status: 'PUBLISHED',
        seoTitle: 'Hawaiian Kona Coffee - Americas Only Commercial Coffee',
        seoDescription:
          'Discover Hawaiian Kona coffee, grown on volcanic slopes with perfect conditions and strict quality standards.',
        seoKeywords:
          'Hawaiian Kona, Kona coffee, Hawaii coffee, volcanic soil, American coffee',
      },
      {
        title: 'The Future of Coffee Origins: Climate Change and Innovation',
        excerpt:
          'Explore how climate change is affecting traditional coffee regions and the innovative solutions being developed for the future.',
        content: `<h2>Coffee in a Changing Climate</h2>
        <p>Climate change poses significant challenges to traditional coffee-growing regions. Rising temperatures, changing rainfall patterns, and increased pest pressure threaten the future of coffee cultivation in many established areas.</p>
        
        <h3>Climate Impact on Coffee Regions</h3>
        <p>Effects of climate change on coffee production:</p>
        <ul>
        <li>Rising temperatures pushing cultivation to higher altitudes</li>
        <li>Irregular rainfall affecting crop yields</li>
        <li>Increased prevalence of coffee leaf rust and other diseases</li>
        <li>Reduced suitable land for coffee cultivation</li>
        </ul>
        
        <h3>Adaptation Strategies</h3>
        <p>Coffee farmers and researchers are developing solutions:</p>
        <ul>
        <li>Climate-resistant coffee varieties</li>
        <li>Agroforestry systems for shade and biodiversity</li>
        <li>Water-efficient irrigation systems</li>
        <li>Integrated pest management</li>
        </ul>
        
        <h3>New Coffee Frontiers</h3>
        <p>As traditional regions face challenges, new areas are emerging as coffee origins:</p>
        <ul>
        <li>Higher altitudes in existing regions</li>
        <li>Previously unsuitable latitudes becoming viable</li>
        <li>Controlled environment agriculture</li>
        <li>Indoor and greenhouse cultivation</li>
        </ul>
        
        <h3>Technology and Innovation</h3>
        <p>Technological advances are helping coffee farming:</p>
        <ul>
        <li>Precision agriculture and IoT sensors</li>
        <li>Genetic research for resistant varieties</li>
        <li>Sustainable processing methods</li>
        <li>Blockchain for supply chain transparency</li>
        </ul>
        
        <h3>Consumer Role</h3>
        <p>Coffee consumers can support sustainability by choosing certified coffees, supporting direct trade, and understanding the true cost of quality coffee production.</p>`,
        featuredImage:
          'https://images.unsplash.com/photo-1587734195503-904fca47e0df?w=800',
        imageAlt: 'Modern sustainable coffee farm with technology integration',
        category: coffeeOriginsCategory._id,
        tags: [
          createdTags.find((t) => t.name === 'Organic')._id,
          createdTags.find((t) => t.name === 'Fair Trade')._id,
          createdTags.find((t) => t.name === 'Arabica')._id,
          createdTags.find((t) => t.name === 'Single Origin')._id,
        ],
        author: adminUser._id,
        status: 'PUBLISHED',
        seoTitle: 'Future Coffee Origins - Climate Change & Innovation',
        seoDescription:
          'Learn how climate change affects coffee origins and the innovations shaping the future of coffee cultivation.',
        seoKeywords:
          'climate change coffee, future coffee origins, sustainable coffee, coffee innovation',
      },
    ];

    // Create blog posts
    for (const postData of blogPosts) {
      let post = await BlogPostModel.findOne({ title: postData.title });
      if (!post) {
        post = new BlogPostModel(postData);
        await post.save();
        console.log(`Created blog post: ${post.title}`);
      }
    }

    // Update category and tag post counts
    for (const category of createdCategories) {
      await category.updatePostCount();
    }

    for (const tag of createdTags) {
      await tag.updatePostCount();
    }

    console.log('Blog data seeding completed successfully!');
    console.log(`Created ${createdCategories.length} categories`);
    console.log(`Created ${createdTags.length} tags`);
    console.log(`Created ${blogPosts.length} blog posts`);
  } catch (error) {
    console.error('Error seeding blog data:', error);
  } finally {
    mongoose.connection.close();
  }
};

// Run the seed script
const runSeed = async () => {
  await connectDB();
  await seedBlogData();
};

runSeed();
